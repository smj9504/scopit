/**
 * Scopit - Customer Service
 */
import api from './api';
import type { Customer, CustomerCreate, PaginatedResponse } from '@/types/entities';

export interface CustomerFilters {
  skip?: number;
  limit?: number;
  search?: string;
  is_active?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCustomer(raw: any): Customer {
  return {
    id: raw.id,
    companyId: raw.company_id ?? raw.companyId,
    name: raw.name,
    contactName: raw.contact_name ?? raw.contactName,
    email: raw.email,
    phone: raw.phone,
    addressLine1: raw.address_line1 ?? raw.addressLine1,
    addressLine2: raw.address_line2 ?? raw.addressLine2,
    city: raw.city,
    state: raw.state,
    zipcode: raw.zipcode,
    notes: raw.notes,
    tags: raw.tags,
    isActive: raw.is_active ?? raw.isActive,
    createdAt: raw.created_at ?? raw.createdAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSnakeCase(data: Partial<CustomerCreate>): Record<string, any> {
  return {
    name: data.name,
    contact_name: data.contactName,
    email: data.email,
    phone: data.phone,
    address_line1: data.addressLine1,
    address_line2: data.addressLine2,
    city: data.city,
    state: data.state,
    zipcode: data.zipcode,
    notes: data.notes,
  };
}

export const customerService = {
  /**
   * Get customers list
   */
  getList: async (filters?: CustomerFilters): Promise<PaginatedResponse<Customer>> => {
    const response = await api.get('/customers', { params: filters });
    const raw = response.data;
    return {
      ...raw,
      items: (raw.items || []).map(toCustomer),
    };
  },

  /**
   * Search customers by name or email
   */
  search: async (query: string, limit: number = 10): Promise<Customer[]> => {
    const response = await api.get('/customers', {
      params: { search: query, limit, is_active: true },
    });
    return (response.data.items || []).map(toCustomer);
  },

  /**
   * Get single customer
   */
  getById: async (id: string): Promise<Customer> => {
    const response = await api.get(`/customers/${id}`);
    return toCustomer(response.data);
  },

  /**
   * Create new customer
   */
  create: async (data: CustomerCreate): Promise<Customer> => {
    const response = await api.post('/customers', toSnakeCase(data));
    return toCustomer(response.data);
  },

  /**
   * Update customer
   */
  update: async (id: string, data: Partial<CustomerCreate>): Promise<Customer> => {
    const response = await api.put(`/customers/${id}`, toSnakeCase(data));
    return toCustomer(response.data);
  },

  /**
   * Delete customer
   */
  delete: async (id: string): Promise<void> => {
    await api.delete(`/customers/${id}`);
  },

  /**
   * Deactivate customer
   */
  deactivate: async (id: string): Promise<Customer> => {
    const response = await api.put(`/customers/${id}`, { is_active: false });
    return toCustomer(response.data);
  },
};

export default customerService;
