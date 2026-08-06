/**
 * Scopit - Estimate Service
 */
import api from './api';
import type {
  Estimate,
  EstimateCreate,
  EstimateSection,
  PaginatedResponse,
  PdfTemplateInfo,
  PdfTemplateId,
  ExcelParseResult,
} from '@/types/entities';

export interface EstimateFilters {
  skip?: number;
  limit?: number;
  status?: string;
  customerId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface BulkActionRequest {
  action: 'delete' | 'move' | 'copy';
  itemIds: string[];
  targetSectionId?: string;
  targetIndex?: number;
}

export interface PaymentCreate {
  amount: number;
  paymentMethod?: string;
  paymentDate?: string;
  referenceNumber?: string;
  notes?: string;
}

export interface AdjustmentCreate {
  type: 'premium' | 'discount';
  name: string;
  percentage: number;
  orderIndex?: number;
}

export interface AdjustmentUpdate {
  type?: 'premium' | 'discount';
  name?: string;
  percentage?: number;
  orderIndex?: number;
}

export const estimateService = {
  /**
   * Convert snake_case estimate response to camelCase
   */
  transformEstimate: (data: any): Estimate => {
    return {
      id: data.id,
      estimateNumber: data.estimate_number || '',
      status: data.status,
      statusId: data.status_id,
      statusConfig: data.status_config ? {
        id: data.status_config.id,
        name: data.status_config.name,
        label: data.status_config.label,
        color: data.status_config.color,
        bgColor: data.status_config.bg_color,
        isDefault: data.status_config.is_default,
        isActive: data.status_config.is_active,
        orderIndex: data.status_config.order_index,
      } : undefined,
      estimateDate: data.estimate_date,
      validUntil: data.valid_until,
      customerId: data.customer_id,
      customerName: data.customer_name,
      customerEmail: data.customer_email,
      customerAddress: data.customer_address,
      title: data.title,
      description: data.description,
      subtotal: Number(data.subtotal || 0),
      taxableSubtotal: Number(data.taxable_subtotal || 0),
      adjustmentsTotal: Number(data.adjustments_total || 0),
      taxRate: Number(data.tax_rate || 0),
      taxLabel: data.tax_label,
      taxAmount: Number(data.tax_amount || 0),
      discountAmount: Number(data.discount_amount || 0),
      total: Number(data.total || 0),
      amountPaid: Number(data.amount_paid || 0),
      balanceDue: Number(data.balance_due || 0),
      notes: data.notes,
      terms: data.terms,
      sections: (data.sections || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        orderIndex: s.order_index,
        isCollapsed: s.is_collapsed || false,
        items: (s.items || []).map((i: any) => ({
          id: i.id,
          sectionId: s.id,
          lineItemId: i.line_item_id,
          code: i.code,
          name: i.name,
          description: i.description,
          unit: i.unit,
          quantity: Number(i.quantity || 0),
          unitPrice: Number(i.unit_price || 0),
          total: Number(i.total || 0),
          isTaxable: i.is_taxable,
          orderIndex: i.order_index,
          notes: i.notes || [],
        })),
        subtotal: Number(s.subtotal || 0),
      })),
      // Flattened items from all sections for convenience
      items: (data.sections || []).flatMap((s: any) =>
        (s.items || []).map((i: any) => ({
          id: i.id,
          sectionId: s.id,
          lineItemId: i.line_item_id,
          code: i.code,
          name: i.name,
          description: i.description,
          unit: i.unit,
          quantity: Number(i.quantity || 0),
          unitPrice: Number(i.unit_price || 0),
          total: Number(i.total || 0),
          isTaxable: i.is_taxable,
          orderIndex: i.order_index,
          notes: i.notes || [],
        }))
      ),
      payments: (data.payments || []).map((p: any) => ({
        id: p.id,
        amount: Number(p.amount || 0),
        paymentMethod: p.payment_method,
        paymentDate: p.payment_date,
        referenceNumber: p.reference_number,
        notes: p.notes,
        createdAt: p.created_at,
      })),
      adjustments: (data.adjustments || []).map((a: any) => ({
        id: a.id,
        type: a.type,
        name: a.name,
        percentage: Number(a.percentage || 0),
        amount: Number(a.amount || 0),
        orderIndex: a.order_index,
        createdAt: a.created_at,
      })),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },

  /**
   * Get estimates list
   */
  getList: async (filters?: EstimateFilters): Promise<PaginatedResponse<Estimate>> => {
    const response = await api.get<any>('/estimates', {
      params: filters,
    });
    return {
      items: response.data.items.map((item: any) => estimateService.transformEstimate(item)),
      total: response.data.total,
      page: response.data.page,
      page_size: response.data.page_size,
    };
  },

  /**
   * Get single estimate
   */
  getById: async (id: string): Promise<Estimate> => {
    const response = await api.get<any>(`/estimates/${id}`);
    return estimateService.transformEstimate(response.data);
  },

  /**
   * Create new estimate
   */
  create: async (data: EstimateCreate): Promise<Estimate> => {
    const response = await api.post<any>('/estimates', data);
    return estimateService.transformEstimate(response.data);
  },

  /**
   * Download Excel template for estimate import
   */
  downloadExcelTemplate: async (): Promise<Blob> => {
    const response = await api.get('/estimates/excel-template', {
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Parse Excel file for estimate import preview
   */
  parseExcelFile: async (file: File): Promise<ExcelParseResult> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/estimates/import-excel', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /**
   * Update estimate
   */
  update: async (id: string, data: Partial<EstimateCreate>): Promise<Estimate> => {
    const response = await api.put<any>(`/estimates/${id}`, data);
    return estimateService.transformEstimate(response.data);
  },

  /**
   * Delete estimate
   */
  delete: async (id: string): Promise<void> => {
    await api.delete(`/estimates/${id}`);
  },

  /**
   * Update estimate status
   */
  updateStatus: async (id: string, statusId: string): Promise<Estimate> => {
    const response = await api.patch<any>(`/estimates/${id}/status`, {
      status_id: statusId,
    });
    return estimateService.transformEstimate(response.data);
  },

  /**
   * Update estimate dates (estimate_date and/or valid_until)
   */
  updateDates: async (
    id: string,
    dates: { estimate_date?: string; valid_until?: string }
  ): Promise<Estimate> => {
    const response = await api.patch<any>(`/estimates/${id}/dates`, dates);
    return estimateService.transformEstimate(response.data);
  },

  /**
   * Send estimate by email
   */
  send: async (
    id: string,
    data: { to: string; subject: string; message: string }
  ): Promise<void> => {
    await api.post(`/estimates/${id}/send`, data);
  },

  /**
   * Convert estimate to invoice
   */
  convert: async (id: string): Promise<{ id: string; invoiceNumber: string }> => {
    const response = await api.post(`/estimates/${id}/convert`);
    // Transform snake_case response to camelCase
    return {
      id: response.data.invoice_id,
      invoiceNumber: response.data.invoice_number,
    };
  },

  /**
   * Get estimate PDF
   */
  getPdf: async (id: string, template?: PdfTemplateId): Promise<Blob> => {
    const response = await api.get(`/estimates/${id}/pdf`, {
      responseType: 'blob',
      params: template ? { template } : undefined,
    });
    return response.data;
  },

  /**
   * Get estimate HTML preview
   */
  getPreview: async (id: string, template?: PdfTemplateId): Promise<string> => {
    const response = await api.get<{ html: string; template: string }>(`/estimates/${id}/preview`, {
      params: template ? { template } : undefined,
    });
    return response.data.html;
  },

  /**
   * Get available PDF templates
   */
  getTemplates: async (): Promise<PdfTemplateInfo[]> => {
    const response = await api.get<PdfTemplateInfo[]>('/estimates/templates');
    return response.data;
  },

  /**
   * Get a sample estimate rendered through a given template, for template pickers
   */
  getTemplateSamplePreview: async (template: PdfTemplateId): Promise<string> => {
    const response = await api.get<{ html: string; template: string }>(
      `/estimates/templates/${template}/sample-preview`
    );
    return response.data.html;
  },

  // Section operations
  sections: {
    /**
     * Create new section
     */
    create: async (
      estimateId: string,
      data: { name: string; orderIndex: number }
    ): Promise<EstimateSection> => {
      const response = await api.post<EstimateSection>(
        `/estimates/${estimateId}/sections`,
        data
      );
      return response.data;
    },

    /**
     * Update section
     */
    update: async (
      estimateId: string,
      sectionId: string,
      data: Partial<{ name: string; isCollapsed: boolean }>
    ): Promise<EstimateSection> => {
      const response = await api.put<EstimateSection>(
        `/estimates/${estimateId}/sections/${sectionId}`,
        data
      );
      return response.data;
    },

    /**
     * Delete section
     */
    delete: async (
      estimateId: string,
      sectionId: string,
      moveItemsTo?: string
    ): Promise<void> => {
      await api.delete(`/estimates/${estimateId}/sections/${sectionId}`, {
        params: { moveItemsTo },
      });
    },

    /**
     * Reorder sections
     */
    reorder: async (estimateId: string, sectionIds: string[]): Promise<void> => {
      await api.put(`/estimates/${estimateId}/sections/reorder`, { sectionIds });
    },
  },

  // Item operations
  items: {
    /**
     * Bulk action on items
     */
    bulkAction: async (
      estimateId: string,
      data: BulkActionRequest
    ): Promise<void> => {
      await api.post(`/estimates/${estimateId}/items/bulk-action`, data);
    },

    /**
     * Reorder item
     */
    reorder: async (
      estimateId: string,
      itemId: string,
      targetSectionId: string,
      targetIndex: number
    ): Promise<void> => {
      await api.put(`/estimates/${estimateId}/items/reorder`, {
        itemId,
        targetSectionId,
        targetIndex,
      });
    },
  },

  // Payment operations
  payments: {
    /**
     * Add payment
     */
    add: async (estimateId: string, data: PaymentCreate): Promise<Estimate> => {
      const response = await api.post<any>(
        `/estimates/${estimateId}/payments`,
        data
      );
      return estimateService.transformEstimate(response.data);
    },

    /**
     * Delete payment
     */
    delete: async (estimateId: string, paymentId: string): Promise<Estimate> => {
      const response = await api.delete<any>(
        `/estimates/${estimateId}/payments/${paymentId}`
      );
      return estimateService.transformEstimate(response.data);
    },
  },

  // Adjustment operations
  adjustments: {
    /**
     * Add adjustment (premium/discount)
     */
    add: async (estimateId: string, data: AdjustmentCreate): Promise<Estimate> => {
      const response = await api.post<any>(
        `/estimates/${estimateId}/adjustments`,
        data
      );
      return estimateService.transformEstimate(response.data);
    },

    /**
     * Update adjustment
     */
    update: async (
      estimateId: string,
      adjustmentId: string,
      data: AdjustmentUpdate
    ): Promise<Estimate> => {
      const response = await api.put<any>(
        `/estimates/${estimateId}/adjustments/${adjustmentId}`,
        data
      );
      return estimateService.transformEstimate(response.data);
    },

    /**
     * Delete adjustment
     */
    delete: async (
      estimateId: string,
      adjustmentId: string
    ): Promise<Estimate> => {
      const response = await api.delete<any>(
        `/estimates/${estimateId}/adjustments/${adjustmentId}`
      );
      return estimateService.transformEstimate(response.data);
    },
  },
};

export default estimateService;
