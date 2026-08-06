/**
 * Scopit - OAuth Callback Page
 */
import React, { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spin, App } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { authService } from '@/services/authService';
import { colors } from '@/styles/theme';

const OAuthCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login, logout } = useAuthStore();
  const { message } = App.useApp();
  const hasProcessed = useRef(false);

  useEffect(() => {
    const handleCallback = async () => {
      // Prevent duplicate execution (React StrictMode or re-renders)
      if (hasProcessed.current) return;
      hasProcessed.current = true;

      const accessToken = searchParams.get('access_token');
      const refreshToken = searchParams.get('refresh_token');
      const error = searchParams.get('error');

      if (error) {
        message.error('Failed to sign in with Google. Please try again.');
        logout(); // Clear any partial state
        navigate('/login');
        return;
      }

      if (accessToken && refreshToken) {
        try {
          // Store tokens first (doesn't set isAuthenticated)
          useAuthStore.getState().setTokens(accessToken, refreshToken);

          // Fetch user info
          const user = await authService.getMe();
          login(user, accessToken, refreshToken);

          message.success('Welcome to Scopit!');
          navigate('/app/dashboard');
        } catch (err) {
          // Clear tokens on error
          logout();
          message.error('Failed to complete sign in. Please try again.');
          navigate('/login');
        }
      } else {
        message.error('Invalid authentication response.');
        logout(); // Clear any partial state
        navigate('/login');
      }
    };

    handleCallback();
  }, [searchParams, navigate, login, logout, message]);

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: colors.bgLight,
      }}
    >
      <Spin size="large" />
      <p style={{ marginTop: 24, color: colors.textSecondary }}>
        Completing sign in...
      </p>
    </div>
  );
};

export default OAuthCallbackPage;
