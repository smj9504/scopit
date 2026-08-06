/**
 * Scopit - Settings Service
 * Manages estimate statuses, invoice statuses, and line item categories
 */
import api from './api';
import type {
  EstimateStatusConfig,
  InvoiceStatusConfig,
  LineItemCategory,
  LineItemUnit,
  StatusConfigCreate,
  StatusConfigUpdate,
  CategoryCreate,
  CategoryUpdate,
  UnitCreate,
  UnitUpdate,
  StatusUsageResponse,
  BulkStatusMigrationRequest,
  BulkStatusMigrationResponse,
} from '@/types/entities';

export const settingsService = {
  // ==================== Estimate Statuses ====================
  estimateStatuses: {
    /**
     * Get all estimate statuses
     */
    list: async (): Promise<EstimateStatusConfig[]> => {
      const response = await api.get<{ items: EstimateStatusConfig[] }>('/settings/estimate-statuses');
      return response.data.items;
    },

    /**
     * Create a new estimate status
     */
    create: async (data: StatusConfigCreate): Promise<EstimateStatusConfig> => {
      const response = await api.post<EstimateStatusConfig>('/settings/estimate-statuses', data);
      return response.data;
    },

    /**
     * Update an estimate status
     */
    update: async (id: string, data: StatusConfigUpdate): Promise<EstimateStatusConfig> => {
      const response = await api.put<EstimateStatusConfig>(`/settings/estimate-statuses/${id}`, data);
      return response.data;
    },

    /**
     * Delete an estimate status
     * @param id - Status ID to delete
     * @param migrateToId - Optional status ID to migrate affected estimates to
     */
    delete: async (id: string, migrateToId?: string): Promise<void> => {
      const params = migrateToId ? { migrate_to: migrateToId } : undefined;
      await api.delete(`/settings/estimate-statuses/${id}`, { params });
    },

    /**
     * Reorder estimate statuses
     */
    reorder: async (ids: string[]): Promise<void> => {
      await api.put('/settings/estimate-statuses/reorder', { ids });
    },

    /**
     * Get usage information for an estimate status
     * Returns count of estimates using this status and whether it can be deleted
     */
    getUsage: async (id: string): Promise<StatusUsageResponse> => {
      const response = await api.get<StatusUsageResponse>(`/settings/estimate-statuses/${id}/usage`);
      return response.data;
    },

    /**
     * Migrate all estimates from one status to another
     */
    migrate: async (fromStatusId: string, toStatusId: string): Promise<BulkStatusMigrationResponse> => {
      const request: BulkStatusMigrationRequest = {
        fromStatusId,
        toStatusId,
      };
      const response = await api.post<BulkStatusMigrationResponse>(
        '/settings/estimate-statuses/migrate',
        { from_status_id: fromStatusId, to_status_id: toStatusId }
      );
      return response.data;
    },
  },

  // ==================== Invoice Statuses ====================
  invoiceStatuses: {
    /**
     * Get all invoice statuses
     */
    list: async (): Promise<InvoiceStatusConfig[]> => {
      const response = await api.get<{ items: InvoiceStatusConfig[] }>('/settings/invoice-statuses');
      return response.data.items;
    },

    /**
     * Create a new invoice status
     */
    create: async (data: StatusConfigCreate): Promise<InvoiceStatusConfig> => {
      const response = await api.post<InvoiceStatusConfig>('/settings/invoice-statuses', data);
      return response.data;
    },

    /**
     * Update an invoice status
     */
    update: async (id: string, data: StatusConfigUpdate): Promise<InvoiceStatusConfig> => {
      const response = await api.put<InvoiceStatusConfig>(`/settings/invoice-statuses/${id}`, data);
      return response.data;
    },

    /**
     * Delete an invoice status
     * @param id - Status ID to delete
     * @param migrateToId - Optional status ID to migrate affected invoices to
     */
    delete: async (id: string, migrateToId?: string): Promise<void> => {
      const params = migrateToId ? { migrate_to: migrateToId } : undefined;
      await api.delete(`/settings/invoice-statuses/${id}`, { params });
    },

    /**
     * Reorder invoice statuses
     */
    reorder: async (ids: string[]): Promise<void> => {
      await api.put('/settings/invoice-statuses/reorder', { ids });
    },

    /**
     * Get usage information for an invoice status
     * Returns count of invoices using this status and whether it can be deleted
     */
    getUsage: async (id: string): Promise<StatusUsageResponse> => {
      const response = await api.get<StatusUsageResponse>(`/settings/invoice-statuses/${id}/usage`);
      return response.data;
    },

    /**
     * Migrate all invoices from one status to another
     */
    migrate: async (fromStatusId: string, toStatusId: string): Promise<BulkStatusMigrationResponse> => {
      const response = await api.post<BulkStatusMigrationResponse>(
        '/settings/invoice-statuses/migrate',
        { from_status_id: fromStatusId, to_status_id: toStatusId }
      );
      return response.data;
    },
  },

  // ==================== Line Item Categories ====================
  categories: {
    /**
     * Get all line item categories
     */
    list: async (): Promise<LineItemCategory[]> => {
      const response = await api.get<{ items: LineItemCategory[] }>('/settings/categories');
      return response.data.items;
    },

    /**
     * Create a new category
     */
    create: async (data: CategoryCreate): Promise<LineItemCategory> => {
      const response = await api.post<LineItemCategory>('/settings/categories', data);
      return response.data;
    },

    /**
     * Update a category
     */
    update: async (id: string, data: CategoryUpdate): Promise<LineItemCategory> => {
      const response = await api.put<LineItemCategory>(`/settings/categories/${id}`, data);
      return response.data;
    },

    /**
     * Delete a category
     */
    delete: async (id: string): Promise<void> => {
      await api.delete(`/settings/categories/${id}`);
    },

    /**
     * Reorder categories
     */
    reorder: async (ids: string[]): Promise<void> => {
      await api.put('/settings/categories/reorder', { ids });
    },
  },

  // ==================== Line Item Units ====================
  units: {
    /**
     * Get all line item units
     */
    list: async (): Promise<LineItemUnit[]> => {
      const response = await api.get<{ items: LineItemUnit[] }>('/settings/units');
      return response.data.items;
    },

    /**
     * Create a new unit
     */
    create: async (data: UnitCreate): Promise<LineItemUnit> => {
      const response = await api.post<LineItemUnit>('/settings/units', data);
      return response.data;
    },

    /**
     * Update a unit
     */
    update: async (id: string, data: UnitUpdate): Promise<LineItemUnit> => {
      const response = await api.put<LineItemUnit>(`/settings/units/${id}`, data);
      return response.data;
    },

    /**
     * Delete a unit
     */
    delete: async (id: string): Promise<void> => {
      await api.delete(`/settings/units/${id}`);
    },

    /**
     * Reorder units
     */
    reorder: async (ids: string[]): Promise<void> => {
      await api.put('/settings/units/reorder', { ids });
    },
  },
};

export default settingsService;
