/**
 * Scopit - PDF Editor: password-protected uploads
 *
 * The backend opens a password-protected PDF only with its password; without
 * the right one it answers 400 with detail.code "pdf_password_required" or
 * "pdf_password_incorrect". usePdfPassword wraps an upload so the user is
 * asked for the password and the upload is tried again with it.
 *
 * Usage:
 *   const withPdfPassword = usePdfPassword();
 *   const doc = await withPdfPassword(
 *     (password) => pdfEditorApi.uploadDocument(file, undefined, 0, password),
 *     file.name,
 *   );
 *   if (!doc) return; // the user cancelled
 */
import React, { useCallback } from 'react';
import { App, Input, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { colors, fonts } from '@/styles/theme';

const { Text } = Typography;

type PasswordCode = 'pdf_password_required' | 'pdf_password_incorrect';

/** The password problem an API error reports, if that's what it is */
export function pdfPasswordProblem(err: unknown): PasswordCode | null {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  const code = (detail as { code?: unknown } | undefined)?.code;
  return code === 'pdf_password_required' || code === 'pdf_password_incorrect' ? code : null;
}

/** A readable message for an API error whose detail may be a string or { message } */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  const message = (detail as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' ? message : fallback;
}

const MAX_ATTEMPTS = 5;

export function usePdfPassword() {
  const { modal } = App.useApp();

  const ask = useCallback(
    (fileName: string, wrong: boolean) =>
      new Promise<string | null>((resolve) => {
        let value = '';
        let settled = false;
        const settle = (result: string | null) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        const dialog = modal.confirm({
          title: wrong ? 'That password didn’t work' : 'This PDF is password protected',
          icon: <LockOutlined style={{ color: colors.textSecondary }} />,
          okText: 'Open',
          // Nothing to open with until a password is typed
          okButtonProps: { disabled: true },
          cancelText: 'Skip',
          content: (
            <div style={{ fontFamily: fonts.body }}>
              <Text style={{ display: 'block', marginBottom: 10, color: colors.textSecondary }}>
                Enter the password to open <Text strong>{fileName}</Text>.
              </Text>
              <Input.Password
                autoFocus
                placeholder="Password"
                onChange={(e) => {
                  value = e.target.value;
                  dialog.update({ okButtonProps: { disabled: !value } });
                }}
                onPressEnter={() => {
                  if (!value) return;
                  dialog.destroy();
                  settle(value);
                }}
              />
            </div>
          ),
          onOk: () => settle(value || null),
          onCancel: () => settle(null),
        });
      }),
    [modal],
  );

  /**
   * Run `upload` (given the password once there is one), asking for the
   * password whenever the server says the PDF needs one. Resolves to null
   * if the user gives up; any other error is thrown as usual.
   */
  return useCallback(
    async <T,>(upload: (password?: string) => Promise<T>, fileName: string): Promise<T | null> => {
      let password: string | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          return await upload(password);
        } catch (err) {
          const problem = pdfPasswordProblem(err);
          if (!problem || attempt >= MAX_ATTEMPTS) throw err;
          const next = await ask(fileName, problem === 'pdf_password_incorrect');
          if (next === null) return null;
          password = next;
        }
      }
    },
    [ask],
  );
}
