/**
 * Scopit - API Client
 *
 * Implements token refresh with queue to prevent race conditions
 * when multiple 401 responses occur simultaneously.
 */
import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/authStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001/api';

// Token refresh state - prevents race conditions
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

// Subscribe to token refresh completion
function subscribeToRefresh(callback: (token: string) => void): void {
  refreshSubscribers.push(callback);
}

// Notify all subscribers with new token
function onRefreshSuccess(newToken: string): void {
  refreshSubscribers.forEach((callback) => callback(newToken));
  refreshSubscribers = [];
}

// Clear subscribers on refresh failure
function onRefreshFailure(): void {
  refreshSubscribers = [];
}

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request interceptor - add auth token
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().accessToken;
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle token refresh with queue
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Only handle 401 errors with a request config
    if (error.response?.status !== 401 || !originalRequest) {
      return Promise.reject(error);
    }

    // Already retried this request - don't retry again
    if (originalRequest._retry) {
      return Promise.reject(error);
    }

    const refreshToken = useAuthStore.getState().refreshToken;

    // No refresh token available. Only force a logout+redirect if this request
    // actually carried a token to begin with (a real session that expired) -
    // an anonymous, tokenless request 401ing (e.g. a public page's background
    // query hitting an auth-required endpoint) has no session to lose, and a
    // hard redirect here would destroy any in-progress anonymous form state.
    if (!refreshToken) {
      const hadToken = !!originalRequest.headers?.Authorization;
      if (hadToken) {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    // Mark request as retried to prevent infinite loops
    originalRequest._retry = true;

    // If refresh is already in progress, queue this request
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        subscribeToRefresh((newToken: string) => {
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
          }
          resolve(api(originalRequest));
        });
        // Note: On refresh failure, the page redirects, so reject isn't strictly needed
        // but we include it for completeness
      });
    }

    // Start refresh process
    isRefreshing = true;

    try {
      const response = await axios.post(`${API_URL}/auth/refresh`, {
        refreshToken,
      });

      const { accessToken } = response.data;

      // Update store with new token
      useAuthStore.getState().setAccessToken(accessToken);

      // Notify all queued requests
      onRefreshSuccess(accessToken);

      // Retry the original request
      if (originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      }
      return api(originalRequest);
    } catch (refreshError) {
      // Refresh failed - clear queue and logout
      onRefreshFailure();
      useAuthStore.getState().logout();
      window.location.href = '/login';
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export default api;

// Error helper
export interface ApiError {
  detail: string | Array<{
    type: string;
    loc: string[];
    msg: string;
    input?: unknown;
    url?: string;
  }> | {
    code: string;
    message: string;
  };
  error_code?: string;
}

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const apiError = error.response?.data as ApiError;

    // Handle FastAPI validation errors (422)
    if (Array.isArray(apiError?.detail)) {
      const messages = apiError.detail.map(err => err.msg).join(', ');
      return messages || 'Validation error';
    }

    // Handle string detail
    if (typeof apiError?.detail === 'string') {
      return apiError.detail;
    }

    // Handle structured { code, message } detail (e.g. EMAIL_NOT_VERIFIED)
    if (apiError?.detail && typeof apiError.detail === 'object' && 'message' in apiError.detail) {
      return apiError.detail.message;
    }

    return error.message || 'An error occurred';
  }
  return 'An unexpected error occurred';
}

/**
 * Extracts the machine-readable error code from a structured `{ code, message }`
 * detail (e.g. EMAIL_NOT_VERIFIED), if present. Returns undefined for the more
 * common string/validation-array detail shapes.
 */
export function getErrorCode(error: unknown): string | undefined {
  if (axios.isAxiosError(error)) {
    const apiError = error.response?.data as ApiError;
    if (apiError?.detail && typeof apiError.detail === 'object' && !Array.isArray(apiError.detail) && 'code' in apiError.detail) {
      return apiError.detail.code;
    }
  }
  return undefined;
}
