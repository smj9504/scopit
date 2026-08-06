/**
 * Scopit - Register Page
 */
import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Form, Input, Button, App } from 'antd';
import { MailOutlined, LockOutlined, UserOutlined, ShopOutlined, GoogleOutlined } from '@ant-design/icons';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';
import { authService } from '@/services/authService';
import { getErrorMessage } from '@/services/api';
import { colors, fonts } from '@/styles/theme';
import VerifyEmailStep from '@/components/auth/VerifyEmailStep';
import type { VerifyEmailResponse } from '@/types/auth';

interface RegisterForm {
  email: string;
  password: string;
  fullName: string;
  companyName: string;
}

interface RegisterLocationState {
  step?: 'verify';
  email?: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001/api';

const RegisterPage: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuthStore();

  const locationState = location.state as RegisterLocationState | null;
  const [step, setStep] = useState<'form' | 'verify'>(
    locationState?.step === 'verify' && locationState.email ? 'verify' : 'form'
  );
  const [pendingEmail, setPendingEmail] = useState(locationState?.email || '');

  const handleGoogleLogin = () => {
    setGoogleLoading(true);
    window.location.href = `${API_URL}/auth/google`;
  };

  const onFinish = async (values: RegisterForm) => {
    setLoading(true);
    try {
      await authService.register(values);
      setPendingEmail(values.email);
      setStep('verify');
      message.success(`We sent a 6-digit code to ${values.email}`);
    } catch (error) {
      console.error('❌ Register Error:', error);
      message.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleVerified = (response: VerifyEmailResponse) => {
    login(response.user, response.accessToken, response.refreshToken);
    message.success('Welcome to Scopit!');
    navigate('/app/dashboard');
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
          style={{ width: '100%', maxWidth: 400 }}
        >
          <div className="auth-card">
            {step === 'verify' ? (
              <VerifyEmailStep
                email={pendingEmail}
                onVerified={handleVerified}
                onBack={() => setStep('form')}
              />
            ) : (
              <>
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
                    Create your account
                  </h1>
                  <p style={{ color: colors.textSecondary, fontSize: 15, margin: 0 }}>
                    Start your free beta today
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
                    or register with email
                  </span>
                  <div style={{ flex: 1, height: 1, background: colors.border }} />
                </div>

                <Form
                  name="register"
                  onFinish={onFinish}
                  layout="vertical"
                  size="large"
                  requiredMark={false}
                >
                  <Form.Item
                    name="fullName"
                    rules={[{ required: true, message: 'Please enter your name' }]}
                  >
                    <Input
                      prefix={<UserOutlined style={{ color: colors.textMuted }} />}
                      placeholder="Your name"
                      autoComplete="name"
                    />
                  </Form.Item>

                  <Form.Item
                    name="companyName"
                    rules={[{ required: true, message: 'Please enter your company name' }]}
                  >
                    <Input
                      prefix={<ShopOutlined style={{ color: colors.textMuted }} />}
                      placeholder="Company name"
                      autoComplete="organization"
                    />
                  </Form.Item>

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
                    rules={[
                      { required: true, message: 'Please enter a password' },
                      { min: 8, message: 'Password must be at least 8 characters' },
                    ]}
                  >
                    <Input.Password
                      prefix={<LockOutlined style={{ color: colors.textMuted }} />}
                      placeholder="Password (min 8 characters)"
                      autoComplete="new-password"
                    />
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
                      Get Started Free
                    </Button>
                  </Form.Item>
                </Form>

                <p
                  style={{
                    textAlign: 'center',
                    marginTop: 16,
                    color: colors.textMuted,
                    fontSize: 13,
                  }}
                >
                  By signing up, you agree to our Terms and Privacy Policy
                </p>
              </>
            )}
          </div>

          <p
            style={{
              textAlign: 'center',
              marginTop: 24,
              color: colors.textSecondary,
              fontSize: 14,
            }}
          >
            Already have an account?{' '}
            <Link
              to="/login"
              style={{
                color: colors.textPrimary,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Sign in
            </Link>
          </p>
        </motion.div>
      </main>
    </div>
  );
};

export default RegisterPage;
