/**
 * Scopit - Company Service
 */
import api from './api';

export interface Company {
  id: string;
  name: string;
  legalName?: string;
  email?: string;
  phone?: string;
  website?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  country?: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;

  // Tax Settings
  defaultTaxRate?: number;
  defaultTaxLabel?: string;

  // Numbering
  estimatePrefix: string;
  invoicePrefix: string;
  nextEstimateNumber: number;
  nextInvoiceNumber: number;

  // Default Settings
  defaultEstimateValidityDays?: number;
  defaultInvoiceDueDays?: number;
  defaultNotes?: string;
  defaultTerms?: string;

  isActive: boolean;
  createdAt: string;
}

export interface CompanyUpdate {
  name?: string;
  legalName?: string;
  email?: string;
  phone?: string;
  website?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  country?: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;

  // Tax Settings
  defaultTaxRate?: number;
  defaultTaxLabel?: string;

  // Numbering
  estimatePrefix?: string;
  invoicePrefix?: string;
  nextEstimateNumber?: number;
  nextInvoiceNumber?: number;

  // Default Settings
  defaultEstimateValidityDays?: number;
  defaultInvoiceDueDays?: number;
  defaultNotes?: string;
  defaultTerms?: string;
}

export const companyService = {
  /**
   * Get current company
   */
  get: async (): Promise<Company> => {
    const response = await api.get<Company>('/company');
    return response.data;
  },

  /**
   * Update company settings
   */
  update: async (data: CompanyUpdate): Promise<Company> => {
    const response = await api.put<Company>('/company', data);
    return response.data;
  },
};

export default companyService;
