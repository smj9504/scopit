/**
 * Scopit - Invoice Service
 */
import api from './api';
import type {
  Invoice,
  InvoiceCreate,
  InvoiceUpdate,
  InvoiceSection,
  PaginatedResponse,
  PaymentMethod,
  PdfTemplateInfo,
  PdfTemplateId,
  ExcelParseResult,
} from '@/types/entities';

export interface InvoiceFilters {
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

export interface RecordPaymentRequest {
  amount: number;
  paymentMethod: PaymentMethod;
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

export const invoiceService = {
  /**
   * Get invoices list
   */
  getList: async (filters?: InvoiceFilters): Promise<PaginatedResponse<Invoice>> => {
    const response = await api.get<PaginatedResponse<Invoice>>('/invoices', {
      params: filters,
    });
    return response.data;
  },

  /**
   * Get single invoice
   */
  getById: async (id: string): Promise<Invoice> => {
    const response = await api.get<Invoice>(`/invoices/${id}`);
    return response.data;
  },

  /**
   * Create new invoice
   */
  create: async (data: InvoiceCreate): Promise<Invoice> => {
    const response = await api.post<Invoice>('/invoices', data);
    return response.data;
  },

  /**
   * Download Excel template for invoice import
   */
  downloadExcelTemplate: async (): Promise<Blob> => {
    const response = await api.get('/invoices/excel-template', {
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Parse Excel file for invoice import preview
   */
  parseExcelFile: async (file: File): Promise<ExcelParseResult> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/invoices/import-excel', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /**
   * Update invoice
   */
  update: async (id: string, data: InvoiceUpdate): Promise<Invoice> => {
    const response = await api.put<Invoice>(`/invoices/${id}`, data);
    return response.data;
  },

  /**
   * Delete invoice
   */
  delete: async (id: string): Promise<void> => {
    await api.delete(`/invoices/${id}`);
  },

  /**
   * Update invoice status
   */
  updateStatus: async (id: string, statusId: string): Promise<Invoice> => {
    const response = await api.patch<Invoice>(`/invoices/${id}/status`, {
      statusId,
    });
    return response.data;
  },

  /**
   * Email the invoice PDF to the customer
   */
  send: async (
    id: string,
    data: { toEmail?: string; ccEmails?: string[]; message?: string; template?: PdfTemplateId }
  ): Promise<Invoice> => {
    const response = await api.post<Invoice>(`/invoices/${id}/send`, data);
    return response.data;
  },

  /**
   * Get invoice PDF
   */
  getPdf: async (id: string, template?: PdfTemplateId): Promise<Blob> => {
    const response = await api.get(`/invoices/${id}/pdf`, {
      responseType: 'blob',
      params: template ? { template } : undefined,
    });
    return response.data;
  },

  /**
   * Get invoice HTML preview
   */
  getPreview: async (id: string, template?: PdfTemplateId): Promise<string> => {
    const response = await api.get<{ html: string; template: string }>(`/invoices/${id}/preview`, {
      params: template ? { template } : undefined,
    });
    return response.data.html;
  },

  /**
   * Get available PDF templates
   */
  getTemplates: async (): Promise<PdfTemplateInfo[]> => {
    const response = await api.get<PdfTemplateInfo[]>('/invoices/templates');
    return response.data;
  },

  /**
   * Mark invoice as sent
   */
  markAsSent: async (id: string): Promise<Invoice> => {
    const response = await api.post<Invoice>(`/invoices/${id}/mark-sent`);
    return response.data;
  },

  /**
   * Cancel invoice
   */
  cancel: async (id: string): Promise<Invoice> => {
    const response = await api.post<Invoice>(`/invoices/${id}/cancel`);
    return response.data;
  },

  // Payment operations
  payments: {
    /**
     * Record a payment
     */
    record: async (invoiceId: string, data: RecordPaymentRequest): Promise<Invoice> => {
      const response = await api.post<Invoice>(
        `/invoices/${invoiceId}/payments`,
        data
      );
      return response.data;
    },

    /**
     * Update a payment
     */
    update: async (invoiceId: string, paymentId: string, data: RecordPaymentRequest): Promise<Invoice> => {
      const response = await api.patch<Invoice>(
        `/invoices/${invoiceId}/payments/${paymentId}`,
        data
      );
      return response.data;
    },

    /**
     * Delete a payment
     */
    delete: async (invoiceId: string, paymentId: string): Promise<Invoice> => {
      const response = await api.delete<Invoice>(
        `/invoices/${invoiceId}/payments/${paymentId}`
      );
      return response.data;
    },

    /**
     * Get payment receipt as PDF
     */
    getReceiptPdf: async (
      invoiceId: string,
      paymentId: string,
      template?: PdfTemplateId
    ): Promise<Blob> => {
      const response = await api.get(
        `/invoices/${invoiceId}/payments/${paymentId}/receipt/pdf`,
        {
          responseType: 'blob',
          params: template ? { template } : undefined,
        }
      );
      return response.data;
    },

    /**
     * Get payment receipt HTML preview
     */
    getReceiptPreview: async (
      invoiceId: string,
      paymentId: string,
      template?: PdfTemplateId
    ): Promise<string> => {
      const response = await api.get<{ html: string; template: string }>(
        `/invoices/${invoiceId}/payments/${paymentId}/receipt/preview`,
        {
          params: template ? { template } : undefined,
        }
      );
      return response.data.html;
    },
  },

  // Section operations
  sections: {
    /**
     * Create new section
     */
    create: async (
      invoiceId: string,
      data: { name: string; orderIndex: number }
    ): Promise<InvoiceSection> => {
      const response = await api.post<InvoiceSection>(
        `/invoices/${invoiceId}/sections`,
        data
      );
      return response.data;
    },

    /**
     * Update section
     */
    update: async (
      invoiceId: string,
      sectionId: string,
      data: Partial<{ name: string; isCollapsed: boolean }>
    ): Promise<InvoiceSection> => {
      const response = await api.put<InvoiceSection>(
        `/invoices/${invoiceId}/sections/${sectionId}`,
        data
      );
      return response.data;
    },

    /**
     * Delete section
     */
    delete: async (
      invoiceId: string,
      sectionId: string,
      moveItemsTo?: string
    ): Promise<void> => {
      await api.delete(`/invoices/${invoiceId}/sections/${sectionId}`, {
        params: { moveItemsTo },
      });
    },

    /**
     * Reorder sections
     */
    reorder: async (invoiceId: string, sectionIds: string[]): Promise<void> => {
      await api.put(`/invoices/${invoiceId}/sections/reorder`, { sectionIds });
    },
  },

  // Item operations
  items: {
    /**
     * Bulk action on items
     */
    bulkAction: async (
      invoiceId: string,
      data: BulkActionRequest
    ): Promise<void> => {
      await api.post(`/invoices/${invoiceId}/items/bulk-action`, data);
    },

    /**
     * Reorder item
     */
    reorder: async (
      invoiceId: string,
      itemId: string,
      targetSectionId: string,
      targetIndex: number
    ): Promise<void> => {
      await api.put(`/invoices/${invoiceId}/items/reorder`, {
        itemId,
        targetSectionId,
        targetIndex,
      });
    },
  },

  // Adjustment operations
  adjustments: {
    /**
     * Add adjustment (premium/discount)
     */
    add: async (invoiceId: string, data: AdjustmentCreate): Promise<Invoice> => {
      const response = await api.post<Invoice>(
        `/invoices/${invoiceId}/adjustments`,
        data
      );
      return response.data;
    },

    /**
     * Update adjustment
     */
    update: async (
      invoiceId: string,
      adjustmentId: string,
      data: AdjustmentUpdate
    ): Promise<Invoice> => {
      const response = await api.put<Invoice>(
        `/invoices/${invoiceId}/adjustments/${adjustmentId}`,
        data
      );
      return response.data;
    },

    /**
     * Delete adjustment
     */
    delete: async (
      invoiceId: string,
      adjustmentId: string
    ): Promise<Invoice> => {
      const response = await api.delete<Invoice>(
        `/invoices/${invoiceId}/adjustments/${adjustmentId}`
      );
      return response.data;
    },
  },
};

export default invoiceService;
