/**
 * ScopeIt - Auth Types
 */

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone?: string;
  avatarUrl?: string;
  companyId: string;
  role: 'admin' | 'manager' | 'staff';
  isActive: boolean;
  isSuperuser?: boolean;
  defaultPdfTemplate?: 'classic' | 'modern' | 'professional' | 'detailed';
  createdAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
  companyName: string;
}

export interface RegisterResponse {
  email: string;
  message: string;
}

export interface VerifyEmailRequest {
  email: string;
  code: string;
}

export interface VerifyEmailResponse extends LoginResponse {}

export interface ResendVerificationRequest {
  email: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  accessToken: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
}
