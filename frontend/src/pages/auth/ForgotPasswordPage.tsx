/**
 * Scopit - Forgot Password Page
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Form, Input, Button, App, Result } from 'antd';
import { MailOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { motion } from 'framer-motion';
import { authService } from '@/services/authService';
import { getErrorMessage } from '@/services/api';
import { colors, fonts } from '@/styles/theme';

const ForgotPasswordPage: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onFinish = async (values: { email: string }) => {
    setLoading(true);
    try {
      await authService.forgotPassword(values);
      setSent(true);
    } catch (error) {
      message.error(getErrorMessage(error));
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
            {sent ? (
              <Result
                status="success"
                title="Check your email"
                subTitle="We've sent a password reset link to your email"
                extra={
                  <Link to="/login">
                    <Button type="primary" style={{ background: colors.primary }}>
                      Back to Login
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
                  Reset password
                </h1>
                <p style={{ color: colors.textSecondary, marginBottom: 32 }}>
                  Enter your email and we'll send you a reset link
                </p>

                <Form onFinish={onFinish} layout="vertical" size="large" requiredMark={false}>
                  <Form.Item
                    name="email"
                    rules={[
                      { required: true, message: 'Please enter your email' },
                      { type: 'email', message: 'Invalid email' },
                    ]}
                  >
                    <Input prefix={<MailOutlined style={{ color: colors.textMuted }} />} placeholder="Email" autoComplete="email" />
                  </Form.Item>

                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    block
                    style={{ fontWeight: 600, background: colors.primary }}
                  >
                    Send Reset Link
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

export default ForgotPasswordPage;
