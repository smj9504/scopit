/**
 * ScopeIt - Email Verification Step
 *
 * Shared between RegisterPage (post-signup) and LoginPage (redirect when an
 * unverified account tries to log in). Collects the 6-digit code emailed by
 * the backend and exchanges it for tokens via authService.verifyEmail().
 */
import React, { useEffect, useState } from 'react';
import { Form, Input, Button, App } from 'antd';
import { MailOutlined } from '@ant-design/icons';
import { authService } from '@/services/authService';
import { getErrorMessage } from '@/services/api';
import { colors, fonts } from '@/styles/theme';
import type { VerifyEmailResponse } from '@/types/auth';

const RESEND_COOLDOWN_SECONDS = 60;

interface VerifyEmailStepProps {
  email: string;
  onVerified: (response: VerifyEmailResponse) => void;
  onBack?: () => void;
}

const VerifyEmailStep: React.FC<VerifyEmailStepProps> = ({ email, onVerified, onBack }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const onFinish = async (values: { code: string }) => {
    setSubmitting(true);
    try {
      const response = await authService.verifyEmail({ email, code: values.code });
      onVerified(response);
    } catch (error) {
      message.error(getErrorMessage(error));
      form.setFieldValue('code', '');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await authService.resendVerificationCode({ email });
      message.success('A new code has been sent to your email');
    } catch (error) {
      message.error(getErrorMessage(error));
    } finally {
      // Stay in sync with the backend's cooldown even if the resend itself
      // failed with 429 (i.e. a cooldown is already active server-side).
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setResending(false);
    }
  };

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: colors.bgSunken,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
          }}
        >
          <MailOutlined style={{ fontSize: 20, color: colors.primary }} />
        </div>
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
          Check your email
        </h1>
        <p style={{ color: colors.textSecondary, fontSize: 15, margin: 0 }}>
          We sent a 6-digit code to <strong style={{ color: colors.textPrimary }}>{email}</strong>
        </p>
      </div>

      <Form form={form} onFinish={onFinish} layout="vertical" requiredMark={false}>
        <Form.Item
          name="code"
          rules={[
            { required: true, message: 'Please enter the 6-digit code' },
            { len: 6, message: 'Code must be 6 digits' },
          ]}
          style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}
        >
          <Input.OTP
            length={6}
            autoFocus
            formatter={(value) => value.replace(/[^\d]/g, '')}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={submitting}
            block
            size="large"
            style={{ fontWeight: 600, background: colors.primary }}
          >
            Verify email
          </Button>
        </Form.Item>
      </Form>

      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <Button
          type="link"
          onClick={handleResend}
          loading={resending}
          disabled={cooldown > 0}
          style={{ fontWeight: 600, padding: 0, color: colors.textPrimary }}
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Didn't get a code? Resend"}
        </Button>
      </div>

      {onBack && (
        <p style={{ textAlign: 'center', marginTop: 16, color: colors.textMuted, fontSize: 13 }}>
          Wrong email?{' '}
          <a
            onClick={onBack}
            style={{ color: colors.textSecondary, fontWeight: 600, cursor: 'pointer' }}
          >
            Go back
          </a>
        </p>
      )}
    </div>
  );
};

export default VerifyEmailStep;
