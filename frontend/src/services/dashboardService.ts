/**
 * Scopit - Dashboard Service
 */
import api from './api';

export interface RecentEstimate {
  id: string;
  estimate_number: string;
  customer_name: string | null;
  total: number;
  status: string;
}

export interface RecentInvoice {
  id: string;
  invoice_number: string;
  customer_name: string | null;
  total: number;
  status: string;
}

export interface DashboardData {
  estimates_this_month: number;
  invoices_this_month: number;
  total_customers: number;
  pending_payments: number;
  recent_estimates: RecentEstimate[];
  recent_invoices: RecentInvoice[];
}

export const dashboardService = {
  /**
   * Get dashboard statistics
   */
  getDashboard: async (): Promise<DashboardData> => {
    const response = await api.get<DashboardData>('/dashboard');
    return response.data;
  },
};

export default dashboardService;
