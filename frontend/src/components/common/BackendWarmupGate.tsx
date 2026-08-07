/**
 * Scopit - Backend Warmup Gate
 *
 * Blocks rendering the app until the API responds, so a cold start on
 * Render's free plan shows our own branded loading state instead of
 * whatever half-loaded UI the app would otherwise show while every page's
 * own data fetches sit unexplained for 30-50s.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Spin } from 'antd';
import { motion } from 'framer-motion';
import { colors, fonts } from '@/styles/theme';
import { warmupBackend } from '@/utils';

type Status = 'checking' | 'waking' | 'ready' | 'failed';

const BackendWarmupGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<Status>('checking');

  const check = useCallback(() => {
    setStatus('checking');
    warmupBackend(() => setStatus('waking'))
      .then(() => setStatus('ready'))
      .catch(() => setStatus('failed'));
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (status === 'ready') {
    return <>{children}</>;
  }

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        background: colors.bgLight,
      }}
    >
      <span
        style={{
          fontFamily: fonts.heading,
          fontSize: 24,
          fontWeight: 700,
          color: colors.primary,
        }}
      >
        Scopit
      </span>

      {status === 'failed' ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{ textAlign: 'center', maxWidth: 320 }}
        >
          <p style={{ color: colors.textSecondary, fontSize: 14, marginBottom: 12 }}>
            The server is taking longer than usual to respond.
          </p>
          <button
            onClick={check}
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: '8px 16px',
              background: colors.bgWhite,
              color: colors.textPrimary,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </motion.div>
      ) : (
        <>
          <Spin size="large" />
          {status === 'waking' && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{
                color: colors.textSecondary,
                fontSize: 14,
                margin: 0,
                maxWidth: 280,
                textAlign: 'center',
              }}
            >
              Waking up the server — this can take up to a minute.
            </motion.p>
          )}
        </>
      )}
    </div>
  );
};

export default BackendWarmupGate;
