/**
 * Scopit - Reset Password Page
 *
 * Opened from the emailed reset link: /reset-password#token=...
 * The token is in the URL fragment so it never reaches a server log or a
 * Referer header; it is read once and removed from the address bar.
 */
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Form, Input, Button, App, Result } from 'antd';
import { LockOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { motion } from 'framer-motion';
import { authService } from '@/services/authService';
import { getErrorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { colors, fonts } from '@/styles/theme';

function readTokenOnce(): string | null {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token');
  if (window.location.hash) {
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }
  return token;
}

const ResetPasswordPage: React.FC = () => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(readTokenOnce);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(!token);

  // Another reset link opened in this same tab only changes the fragment,
  // which doesn't reload the page: pick up its token.
  useEffect(() => {
    const onHash = () => {
      const next = readTokenOnce();
      if (!next) return;
      setToken(next);
      setDone(false);
      setLinkInvalid(false);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const onFinish = async (values: { password: string }) => {
    if (!token) return;
    setLoading(true);
    try {
      await authService.resetPassword({ token, password: values.password });
      // The reset signs the account out everywhere, this browser included.
      useAuthStore.getState().logout();
      setDone(true);
    } catch (error) {
      const text = getErrorMessage(error);
      if (/invalid or has expired/i.test(text)) {
        setLinkInvalid(true);
      } else {
        message.error(text);
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
      <header
        style={{
          padding: '20px 24px',
          background: colors.bgWhite,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <Link to="/" style={{ textDecoration: 'none' }}>
          <span style={{ fontFamily: fonts.heading, fontSize: 20, fontWeight: 700, color: colors.primary }}>
            Scopit
          </span>
        </Link>
      </header>

      <main className="auth-page-main">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ width: '100%', maxWidth: 400 }}
        >
          <div className="auth-card">
            {done ? (
              <Result
                status="success"
                title="Password updated"
                subTitle="Sign in with your new password."
                extra={
                  <Button
                    type="primary"
                    style={{ background: colors.primary }}
                    onClick={() => navigate('/login', { replace: true })}
                  >
                    Sign in
                  </Button>
                }
              />
            ) : linkInvalid ? (
              <Result
                status="warning"
                title="This link can't be used"
                subTitle="Reset links work once and expire after 30 minutes. Request a new one."
                extra={
                  <Link to="/forgot-password">
                    <Button type="primary" style={{ background: colors.primary }}>
                      Send a new link
                    </Button>
                  </Link>
                }
              />
            ) : (
              <>
                <Link
                  to="/login"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.textSecondary, marginBottom: 24 }}
                >
                  <ArrowLeftOutlined /> Back to login
                </Link>

                <h1 style={{ fontFamily: fonts.heading, fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
                  Choose a new password
                </h1>
                <p style={{ color: colors.textSecondary, marginBottom: 32 }}>
                  You'll be signed out on every device and can sign in with the new password.
                </p>

                <Form onFinish={onFinish} layout="vertical" size="large" requiredMark={false}>
                  <Form.Item
                    name="password"
                    rules={[
                      { required: true, message: 'Please enter a new password' },
                      { min: 8, message: 'Password must be at least 8 characters' },
                      { max: 72, message: 'Password must be at most 72 characters' },
                    ]}
                  >
                    <Input.Password
                      prefix={<LockOutlined style={{ color: colors.textMuted }} />}
                      placeholder="New password (min 8 characters)"
                      autoComplete="new-password"
                    />
                  </Form.Item>
                  <Form.Item
                    name="confirm"
                    dependencies={['password']}
                    rules={[
                      { required: true, message: 'Please confirm the new password' },
                      ({ getFieldValue }) => ({
                        validator(_, value) {
                          return !value || getFieldValue('password') === value
                            ? Promise.resolve()
                            : Promise.reject(new Error('Passwords do not match'));
                        },
                      }),
                    ]}
                  >
                    <Input.Password
                      prefix={<LockOutlined style={{ color: colors.textMuted }} />}
                      placeholder="Confirm new password"
                      autoComplete="new-password"
                    />
                  </Form.Item>

                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    block
                    style={{ fontWeight: 600, background: colors.primary }}
                  >
                    Update password
                  </Button>
                </Form>
              </>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  );
};

export default ResetPasswordPage;
