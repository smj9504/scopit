/**
 * Scopit - Packing Lead Email Verification
 * Route: /packing-estimate/verify/:token (no authentication required)
 *
 * Same-page 6-digit code entry, modeled visually on VerifyEmailStep (the
 * register flow's post-signup verification step). On success, background AI
 * analysis has started server-side — hand off to the result page, which is
 * the single source of truth for status display (including the failed state
 * if the daily cap was already hit at verification time).
 */
import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Form, Input, Button, App } from 'antd';
import { MailOutlined } from '@ant-design/icons';
import { colors, fonts } from '@/styles/theme';
import { usePageSEO } from '@/hooks/usePageSEO';
import { packingLeadService } from '@/services/packingLeadService';
import { getErrorMessage } from '@/services/api';

const PackingLeadVerifyPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  usePageSEO({
    title: 'Verify your email | Scopit',
    description: 'Enter the code we emailed you to continue to your packing estimate.',
    path: '/packing-estimate/verify',
  });

  const onFinish = async (values: { code: string }) => {
    if (!token) return;
    setSubmitting(true);
    try {
      await packingLeadService.verifyEmail(token, values.code);
      // Both 'analyzing' and 'failed' land on the result page — it owns
      // status display so there's no duplicated UI here.
      navigate(`/packing-estimate/result/${token}`);
    } catch (error) {
      message.error(getErrorMessage(error));
      form.setFieldValue('code', '');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: colors.bgLight,
        fontFamily: fonts.body,
      }}
    >
      <header
        style={{
          padding: '20px 24px',
          background: colors.bgWhite,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
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
      </header>

      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 16px',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 400,
            background: colors.bgWhite,
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            padding: 32,
          }}
        >
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
              Enter the 6-digit code we just sent you to see your packing estimate.
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
        </div>
      </main>
    </div>
  );
};

export default PackingLeadVerifyPage;
