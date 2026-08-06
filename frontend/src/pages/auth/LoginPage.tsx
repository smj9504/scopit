/**
 * Scopit - Login Page
 */
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Form, Input, Button, App } from 'antd';
import { MailOutlined, LockOutlined, GoogleOutlined } from '@ant-design/icons';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';
import { authService } from '@/services/authService';
import { getErrorMessage, getErrorCode } from '@/services/api';
import { colors, fonts } from '@/styles/theme';

interface LoginForm {
  email: string;
  password: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001/api';

const LoginPage: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuthStore();

  const handleGoogleLogin = () => {
    setGoogleLoading(true);
    window.location.href = `${API_URL}/auth/google`;
  };

  const onFinish = async (values: LoginForm) => {
    setLoading(true);
    try {
      const response = await authService.login(values);
      console.log('🔍 Login Response:', response);
      console.log('🔑 Access Token:', response.accessToken);
      console.log('🔑 Refresh Token:', response.refreshToken);
      console.log('👤 User:', response.user);

      login(response.user, response.accessToken, response.refreshToken);

      // Verify store after login
      const storeState = useAuthStore.getState();
      console.log('📦 Store State After Login:', {
        hasAccessToken: !!storeState.accessToken,
        hasRefreshToken: !!storeState.refreshToken,
        isAuthenticated: storeState.isAuthenticated,
        user: storeState.user,
      });

      message.success('Welcome back!');
      navigate('/app/dashboard');
    } catch (error) {
      console.error('❌ Login Error:', error);
      if (getErrorCode(error) === 'EMAIL_NOT_VERIFIED') {
        message.info('Please verify your email to continue.');
        navigate('/register', { state: { step: 'verify', email: values.email } });
      } else {
        message.error(getErrorMessage(error));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: colors.bgLight,
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: '20px 24px',
          background: colors.bgWhite,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <Link to="/" style={{ textDecoration: 'none' }}>
          <span
            style={{
              fontFamily: fonts.heading,
              fontSize: 20,
              fontWeight: 700,
              color: colors.primary,
            }}
          >
            Scopit
          </span>
        </Link>
      </header>

      {/* Content */}
      <main className="auth-page-main">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          style={{
            width: '100%',
            maxWidth: 400,
          }}
        >
          <div className="auth-card">
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <h1
                style={{
                  fontFamily: fonts.heading,
                  fontSize: 24,
                  fontWeight: 700,
                  color: colors.textPrimary,
                  margin: 0,
                  marginBottom: 8,
                }}
              >
                Welcome back
              </h1>
              <p
                style={{
                  color: colors.textSecondary,
                  fontSize: 15,
                  margin: 0,
                }}
              >
                Sign in to your account
              </p>
            </div>

            {/* Google Login Button */}
            <Button
              type="default"
              htmlType="button"
              icon={!googleLoading && <GoogleOutlined />}
              onClick={handleGoogleLogin}
              loading={googleLoading}
              disabled={googleLoading}
              block
              size="large"
              style={{
                fontWeight: 600,
                marginBottom: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              {googleLoading ? 'Connecting...' : 'Continue with Google'}
            </Button>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: 24,
              }}
            >
              <div style={{ flex: 1, height: 1, background: colors.border }} />
              <span style={{ padding: '0 16px', color: colors.textMuted, fontSize: 13 }}>
                or sign in with email
              </span>
              <div style={{ flex: 1, height: 1, background: colors.border }} />
            </div>

            <Form
              name="login"
              onFinish={onFinish}
              layout="vertical"
              size="large"
              requiredMark={false}
            >
              <Form.Item
                name="email"
                rules={[
                  { required: true, message: 'Please enter your email' },
                  { type: 'email', message: 'Please enter a valid email' },
                ]}
              >
                <Input
                  prefix={<MailOutlined style={{ color: colors.textMuted }} />}
                  placeholder="Email"
                  autoComplete="email"
                />
              </Form.Item>

              <Form.Item
                name="password"
                rules={[{ required: true, message: 'Please enter your password' }]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: colors.textMuted }} />}
                  placeholder="Password"
                  autoComplete="current-password"
                />
              </Form.Item>

              <Form.Item style={{ marginBottom: 16 }}>
                <Link
                  to="/forgot-password"
                  style={{
                    color: colors.textSecondary,
                    fontSize: 14,
                    textDecoration: 'none',
                  }}
                >
                  Forgot password?
                </Link>
              </Form.Item>

              <Form.Item style={{ marginBottom: 0 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  block
                  style={{
                    fontWeight: 600,
                    background: colors.primary,
                  }}
                >
                  Sign In
                </Button>
              </Form.Item>
            </Form>
          </div>

          <p
            style={{
              textAlign: 'center',
              marginTop: 24,
              color: colors.textSecondary,
              fontSize: 14,
            }}
          >
            Don't have an account?{' '}
            <Link
              to="/register"
              style={{
                color: colors.textPrimary,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Get started free
            </Link>
          </p>
        </motion.div>
      </main>
    </div>
  );
};

export default LoginPage;
