/**
 * Scopit - Auth Service
 */
import api from './api';
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  VerifyEmailRequest,
  VerifyEmailResponse,
  ResendVerificationRequest,
  RefreshTokenResponse,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  User,
} from '@/types/auth';

export const authService = {
  /**
   * Login with email and password
   */
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const response = await api.post<any>('/auth/login', data);
    // Convert snake_case to camelCase
    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      user: {
        id: response.data.user.id,
        email: response.data.user.email,
        fullName: response.data.user.full_name || '',
        phone: response.data.user.phone,
        avatarUrl: response.data.user.avatar_url,
        companyId: response.data.user.company_id || '',
        role: response.data.user.role,
        isActive: response.data.user.is_active,
        isSuperuser: response.data.user.is_superuser,
        defaultPdfTemplate: response.data.user.default_pdf_template || 'classic',
        hasPassword: response.data.user.has_password,
        createdAt: response.data.user.created_at,
      },
    };
  },

  /**
   * Register new user and company. Does not log in — a verification code is
   * emailed and must be confirmed via verifyEmail() before tokens are issued.
   */
  register: async (data: RegisterRequest): Promise<RegisterResponse> => {
    // Convert camelCase to snake_case for backend
    const response = await api.post<any>('/auth/register', {
      email: data.email,
      password: data.password,
      full_name: data.fullName,
      company_name: data.companyName,
    });
    return {
      email: response.data.email,
      message: response.data.message,
    };
  },

  /**
   * Confirm the emailed 6-digit code. Returns tokens + user on success, same
   * shape as login().
   */
  verifyEmail: async (data: VerifyEmailRequest): Promise<VerifyEmailResponse> => {
    const response = await api.post<any>('/auth/verify-email', {
      email: data.email,
      code: data.code,
    });
    // Convert snake_case to camelCase
    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      user: {
        id: response.data.user.id,
        email: response.data.user.email,
        fullName: response.data.user.full_name || '',
        phone: response.data.user.phone,
        avatarUrl: response.data.user.avatar_url,
        companyId: response.data.user.company_id || '',
        role: response.data.user.role,
        isActive: response.data.user.is_active,
        isSuperuser: response.data.user.is_superuser,
        defaultPdfTemplate: response.data.user.default_pdf_template || 'classic',
        hasPassword: response.data.user.has_password,
        createdAt: response.data.user.created_at,
      },
    };
  },

  /**
   * Request a fresh verification code (invalidates the previous one).
   */
  resendVerificationCode: async (data: ResendVerificationRequest): Promise<void> => {
    await api.post('/auth/resend-verification-code', data);
  },

  /**
   * Refresh access token
   */
  refresh: async (refreshToken: string): Promise<RefreshTokenResponse> => {
    const response = await api.post<any>('/auth/refresh', {
      refresh_token: refreshToken,  // Convert to snake_case for backend
    });
    // Convert snake_case to camelCase
    return {
      accessToken: response.data.access_token,
    };
  },

  /**
   * Get current user info
   */
  getMe: async (): Promise<User> => {
    const response = await api.get<any>('/auth/me');
    // Convert snake_case to camelCase
    return {
      id: response.data.id,
      email: response.data.email,
      fullName: response.data.full_name || '',
      phone: response.data.phone,
      avatarUrl: response.data.avatar_url,
      companyId: response.data.company_id || '',
      role: response.data.role,
      isActive: response.data.is_active,
      isSuperuser: response.data.is_superuser,
      defaultPdfTemplate: response.data.default_pdf_template || 'classic',
      hasPassword: response.data.has_password,
      createdAt: response.data.created_at,
    };
  },

  /**
   * Update current user profile
   */
  updateProfile: async (data: { fullName?: string; defaultPdfTemplate?: string }): Promise<User> => {
    const response = await api.patch<any>('/auth/me', {
      full_name: data.fullName,
      default_pdf_template: data.defaultPdfTemplate,
    });
    // Convert snake_case to camelCase
    return {
      id: response.data.id,
      email: response.data.email,
      fullName: response.data.full_name || '',
      phone: response.data.phone,
      avatarUrl: response.data.avatar_url,
      companyId: response.data.company_id || '',
      role: response.data.role,
      isActive: response.data.is_active,
      isSuperuser: response.data.is_superuser,
      defaultPdfTemplate: response.data.default_pdf_template || 'classic',
      hasPassword: response.data.has_password,
      createdAt: response.data.created_at,
    };
  },

  /**
   * Change password
   */
  changePassword: async (data: { currentPassword: string; newPassword: string }): Promise<void> => {
    await api.post('/auth/me/change-password', {
      current_password: data.currentPassword,
      new_password: data.newPassword,
    });
  },

  /**
   * Set a password for an OAuth account that doesn't have one yet
   */
  setPassword: async (data: { newPassword: string }): Promise<void> => {
    await api.post('/auth/me/set-password', {
      new_password: data.newPassword,
    });
  },

  /**
   * Logout
   */
  logout: async (): Promise<void> => {
    await api.post('/auth/logout');
  },

  /**
   * Request password reset email
   */
  forgotPassword: async (data: ForgotPasswordRequest): Promise<void> => {
    await api.post('/auth/forgot-password', data);
  },

  /**
   * Reset password with token
   */
  resetPassword: async (data: ResetPasswordRequest): Promise<void> => {
    await api.post('/auth/reset-password', data);
  },
};

export default authService;
