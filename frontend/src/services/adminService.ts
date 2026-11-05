/**
 * Scopit - Admin Service
 * API calls for admin dashboard (superuser only)
 */
import api from './api';
import type {
  AdminDashboard,
  AdminUserListResponse,
  AdminUserDetail,
  GeographyAnalytics,
  OccupationAnalytics,
  AdminInquiry,
  AdminInquiryListResponse,
  InquiryStatus,
} from '@/types/admin';

// Transform snake_case to camelCase for frontend
const transformDashboard = (data: any): AdminDashboard => ({
  totalUsers: data.total_users,
  newUsersToday: data.new_users_today,
  newUsersThisWeek: data.new_users_this_week,
  newUsersThisMonth: data.new_users_this_month,
  activeUsersToday: data.active_users_today,
  totalCompanies: data.total_companies,
  totalEstimates: data.total_estimates,
  totalInvoices: data.total_invoices,
  estimatesThisMonth: data.estimates_this_month,
  invoicesThisMonth: data.invoices_this_month,
  occupationStats: data.occupation_stats,
  recentUsers: data.recent_users.map((u: any) => ({
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    companyName: u.company_name,
    occupation: u.occupation,
    signupState: u.signup_state,
    createdAt: u.created_at,
  })),
  userGrowthData: data.user_growth_data,
});

const transformUser = (data: any) => ({
  id: data.id,
  email: data.email,
  fullName: data.full_name,
  phone: data.phone,
  avatarUrl: data.avatar_url,
  companyId: data.company_id,
  companyName: data.company_name,
  occupation: data.occupation,
  occupationOther: data.occupation_other,
  businessType: data.business_type,
  yearsInBusiness: data.years_in_business,
  signupCity: data.signup_city,
  signupState: data.signup_state,
  signupCountry: data.signup_country,
  lastLoginCity: data.last_login_city,
  lastLoginState: data.last_login_state,
  loginCount: data.login_count,
  lastLoginAt: data.last_login_at,
  role: data.role,
  isActive: data.is_active,
  isVerified: data.is_verified,
  isSuperuser: data.is_superuser,
  createdAt: data.created_at,
  updatedAt: data.updated_at,
});

const transformLoginLog = (data: any) => ({
  id: data.id,
  loginAt: data.login_at,
  loginMethod: data.login_method,
  ipAddress: data.ip_address,
  city: data.city,
  state: data.state,
  country: data.country,
  deviceType: data.device_type,
  browser: data.browser,
  os: data.os,
});

const transformInquiry = (data: any): AdminInquiry => ({
  id: data.id,
  userId: data.user_id,
  email: data.email,
  name: data.name,
  companyName: data.company_name,
  category: data.category,
  message: data.message,
  pageUrl: data.page_url,
  userAgent: data.user_agent,
  status: data.status,
  createdAt: data.created_at,
  resolvedAt: data.resolved_at,
});

export const adminService = {
  /**
   * Get admin dashboard data
   */
  getDashboard: async (): Promise<AdminDashboard> => {
    const response = await api.get('/admin/dashboard');
    return transformDashboard(response.data);
  },

  /**
   * Get paginated user list
   */
  getUsers: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    occupation?: string;
    state?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<AdminUserListResponse> => {
    const response = await api.get('/admin/users', {
      params: {
        page: params?.page || 1,
        limit: params?.limit || 20,
        search: params?.search,
        occupation: params?.occupation,
        state: params?.state,
        sort_by: params?.sortBy || 'created_at',
        sort_order: params?.sortOrder || 'desc',
      },
    });

    return {
      items: response.data.items.map(transformUser),
      total: response.data.total,
      page: response.data.page,
      limit: response.data.limit,
    };
  },

  /**
   * Get user detail with login history
   */
  getUserDetail: async (userId: string): Promise<AdminUserDetail> => {
    const response = await api.get(`/admin/users/${userId}`);
    const data = response.data;

    return {
      ...transformUser(data),
      estimateCount: data.estimate_count,
      invoiceCount: data.invoice_count,
      customerCount: data.customer_count,
      recentLogins: data.recent_logins.map(transformLoginLog),
    };
  },

  /**
   * Toggle user active status
   */
  toggleUserActive: async (
    userId: string,
    isActive: boolean
  ): Promise<void> => {
    await api.patch(`/admin/users/${userId}/toggle-active`, null, {
      params: { is_active: isActive },
    });
  },

  /**
   * Get geography analytics
   */
  getGeographyAnalytics: async (): Promise<GeographyAnalytics> => {
    const response = await api.get('/admin/analytics/geography');
    return {
      byState: response.data.by_state.map((s: any) => ({
        state: s.state,
        city: s.city,
        userCount: s.user_count,
        companyCount: s.company_count,
      })),
      totalStates: response.data.total_states,
    };
  },

  /**
   * Get occupation analytics
   */
  getOccupationAnalytics: async (): Promise<OccupationAnalytics> => {
    const response = await api.get('/admin/analytics/occupation');
    return {
      stats: response.data.stats,
      totalUsers: response.data.total_users,
    };
  },

  /**
   * Get support inquiries, newest first
   */
  getInquiries: async (params?: {
    status?: InquiryStatus;
    page?: number;
    limit?: number;
  }): Promise<AdminInquiryListResponse> => {
    const response = await api.get('/admin/inquiries', {
      params: {
        status: params?.status,
        page: params?.page || 1,
        limit: params?.limit || 20,
      },
    });
    return {
      items: response.data.items.map(transformInquiry),
      total: response.data.total,
      openCount: response.data.open_count,
      page: response.data.page,
      limit: response.data.limit,
    };
  },

  /**
   * Mark an inquiry resolved, or reopen it
   */
  setInquiryStatus: async (
    inquiryId: string,
    status: InquiryStatus
  ): Promise<AdminInquiry> => {
    const response = await api.patch(`/admin/inquiries/${inquiryId}`, { status });
    return transformInquiry(response.data);
  },
};

export default adminService;
