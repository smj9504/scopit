/**
 * Scopit - Admin Types
 */

export interface OccupationStat {
  occupation: string;
  count: number;
  percentage: number;
}

export interface DailyCount {
  date: string;
  count: number;
}

export interface UserSummary {
  id: string;
  email: string;
  fullName: string | null;
  companyName: string | null;
  occupation: string | null;
  signupState: string | null;
  createdAt: string;
}

export interface AdminDashboard {
  totalUsers: number;
  newUsersToday: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
  activeUsersToday: number;
  totalCompanies: number;
  totalEstimates: number;
  totalInvoices: number;
  estimatesThisMonth: number;
  invoicesThisMonth: number;
  occupationStats: OccupationStat[];
  recentUsers: UserSummary[];
  userGrowthData: DailyCount[];
}

export interface LoginLog {
  id: string;
  loginAt: string;
  loginMethod: string | null;
  ipAddress: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  companyId: string | null;
  companyName: string | null;
  occupation: string | null;
  occupationOther: string | null;
  businessType: string | null;
  yearsInBusiness: number | null;
  signupCity: string | null;
  signupState: string | null;
  signupCountry: string | null;
  lastLoginCity: string | null;
  lastLoginState: string | null;
  loginCount: number;
  lastLoginAt: string | null;
  role: string;
  isActive: boolean;
  isVerified: boolean;
  isSuperuser: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface AdminUserDetail extends AdminUser {
  estimateCount: number;
  invoiceCount: number;
  customerCount: number;
  recentLogins: LoginLog[];
}

export interface AdminUserListResponse {
  items: AdminUser[];
  total: number;
  page: number;
  limit: number;
}

export interface GeographyStat {
  state: string;
  city: string | null;
  userCount: number;
  companyCount: number;
}

export interface GeographyAnalytics {
  byState: GeographyStat[];
  totalStates: number;
}

export interface OccupationAnalytics {
  stats: OccupationStat[];
  totalUsers: number;
}
