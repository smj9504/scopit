/**
 * Scopit - OAuth Callback Page
 *
 * Google sends the browser back here (via the API) with a one-time code and
 * the state this tab created, in the URL fragment. The code is exchanged for
 * tokens only if the state matches -- see utils/googleSignIn.ts.
 */
import React, { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spin, App } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { authService } from '@/services/authService';
import { takeStoredGoogleState, takeStoredReturnTo } from '@/utils/googleSignIn';
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

      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const code = fragment.get('code');
      const state = fragment.get('state');
      const expectedState = takeStoredGoogleState();

      // Drop the code from the address bar and history right away.
      window.history.replaceState(null, '', window.location.pathname);

      const fail = (text: string) => {
        logout(); // Clear any partial state
        message.error(text);
        navigate('/login', { replace: true });
      };

      if (searchParams.get('error')) {
        fail('Failed to sign in with Google. Please try again.');
        return;
      }

      if (!code || !state || !expectedState || state !== expectedState) {
        // Not a sign-in this tab started (or an outdated link): don't use it.
        fail('That sign-in link is not valid. Please sign in again.');
        return;
      }

      try {
        const { user, accessToken, refreshToken } = await authService.googleExchange(code, state);
        login(user, accessToken, refreshToken);
        message.success('Welcome to Scopit!');
        navigate(takeStoredReturnTo() || '/app/dashboard', { replace: true });
      } catch {
        fail('Failed to complete sign in. Please try again.');
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
