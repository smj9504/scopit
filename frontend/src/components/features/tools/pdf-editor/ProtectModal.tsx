/**
 * Scopit - PDF Editor: Protect a PDF
 *
 * Downloads a password-protected copy of the document (edits burned in):
 * a password to open it and/or a permissions password that restricts
 * printing, copying, changing pages and commenting. The document in Scopit
 * stays unprotected, so it can still be edited.
 *
 * Usage:
 *   <ProtectModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     documentId={doc.id}
 *     documentName={doc.name}
 *     beforeDownload={() => handleSave(true)}
 *   />
 */
import React, { useEffect, useState } from 'react';
import { App, Alert, Button, Checkbox, Input, Modal, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { pdfEditorApi } from './pdfEditorApi';
import { apiErrorMessage } from './pdfPassword';
import type { ProtectOptions } from './types';
import { colors, fonts, borderRadius, fontSizes, fontWeights } from '@/styles/theme';

const { Text } = Typography;

// The server takes any password; this keeps a one-key password from passing
// for protection
const MIN_PASSWORD_LENGTH = 4;

export interface ProtectModalProps {
  open: boolean;
  onClose: () => void;
  documentId: string;
  documentName: string;
  /** Saves pending edits so the download includes them; false = stop */
  beforeDownload: () => Promise<boolean>;
}

/** The error message of a failed blob request (its body is a Blob, not JSON) */
async function blobErrorMessage(err: unknown, fallback: string): Promise<string> {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      return apiErrorMessage({ response: { data: JSON.parse(await data.text()) } }, fallback);
    } catch {
      return fallback;
    }
  }
  return apiErrorMessage(err, fallback);
}

function passwordError(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) return 'The passwords don’t match.';
  return null;
}

const S = {
  section: (enabled: boolean): React.CSSProperties => ({
    border: `1px solid ${enabled ? colors.borderDark : colors.border}`,
    borderRadius: borderRadius.md,
    padding: '12px 14px',
    marginBottom: 12,
    background: enabled ? colors.bgWhite : colors.bgLight,
    transition: 'border-color 0.15s ease, background 0.15s ease',
  }),
  sectionHint: {
    display: 'block',
    fontSize: fontSizes.xs,
    color: colors.textMuted,
    margin: '2px 0 0 24px',
    lineHeight: 1.5,
  } as React.CSSProperties,
  fields: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    margin: '12px 0 0 24px',
  },
  fieldError: {
    fontSize: fontSizes.xs,
    color: colors.error,
  },
  allowList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '6px 12px',
    marginTop: 4,
  },
  label: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    color: colors.textSecondary,
    marginTop: 4,
  },
};

const ProtectModal: React.FC<ProtectModalProps> = ({
  open,
  onClose,
  documentId,
  documentName,
  beforeDownload,
}) => {
  const { message } = App.useApp();

  const [requireOpen, setRequireOpen] = useState(true);
  const [openPassword, setOpenPassword] = useState('');
  const [openConfirm, setOpenConfirm] = useState('');

  const [restrict, setRestrict] = useState(false);
  const [permissionsPassword, setPermissionsPassword] = useState('');
  const [permissionsConfirm, setPermissionsConfirm] = useState('');
  const [allowPrinting, setAllowPrinting] = useState(true);
  const [allowCopying, setAllowCopying] = useState(true);
  const [allowEditing, setAllowEditing] = useState(true);
  const [allowCommenting, setAllowCommenting] = useState(true);

  const [submitted, setSubmitted] = useState(false);
  const [working, setWorking] = useState(false);

  // Fresh form every time: passwords never linger in a closed dialog
  useEffect(() => {
    if (!open) return;
    setRequireOpen(true);
    setOpenPassword('');
    setOpenConfirm('');
    setRestrict(false);
    setPermissionsPassword('');
    setPermissionsConfirm('');
    setAllowPrinting(true);
    setAllowCopying(true);
    setAllowEditing(true);
    setAllowCommenting(true);
    setSubmitted(false);
    setWorking(false);
  }, [open]);

  const openError = requireOpen ? passwordError(openPassword, openConfirm) : null;
  let permissionsError = restrict ? passwordError(permissionsPassword, permissionsConfirm) : null;
  if (!permissionsError && restrict && requireOpen && permissionsPassword === openPassword) {
    permissionsError = 'Use a different password than the one that opens the document.';
  }
  const formError = !requireOpen && !restrict ? 'Choose at least one kind of protection.' : null;
  const valid = !formError && !openError && !permissionsError;
  const allAllowed = allowPrinting && allowCopying && allowEditing && allowCommenting;

  const handleProtect = async () => {
    setSubmitted(true);
    if (!valid || working) return;
    setWorking(true);
    try {
      if (!(await beforeDownload())) return;
      const options: ProtectOptions = {
        openPassword: requireOpen ? openPassword : undefined,
        permissionsPassword: restrict ? permissionsPassword : undefined,
        allowPrinting: !restrict || allowPrinting,
        allowCopying: !restrict || allowCopying,
        allowEditing: !restrict || allowEditing,
        allowCommenting: !restrict || allowCommenting,
      };
      const blob = await pdfEditorApi.protectDocument(documentId, options);
      const base = documentName.replace(/\.pdf$/i, '') || 'document';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${base} (protected).pdf`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('Protected PDF downloaded');
      onClose();
    } catch (err) {
      message.error(await blobErrorMessage(err, 'Couldn’t protect the PDF. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  const showErrors = submitted;

  return (
    <Modal
      open={open}
      onCancel={working ? undefined : onClose}
      maskClosable={!working}
      closable={!working}
      width={520}
      destroyOnHidden
      title={
        <span style={{ fontFamily: fonts.heading, fontWeight: 600, fontSize: fontSizes.md, display: 'flex', alignItems: 'center', gap: 8 }}>
          <LockOutlined style={{ color: colors.textSecondary }} />
          Protect a PDF
        </span>
      }
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose} disabled={working} style={{ fontFamily: fonts.body }}>
            Cancel
          </Button>
          <Button
            type="primary"
            onClick={handleProtect}
            loading={working}
            disabled={showErrors && !valid}
            style={{ fontFamily: fonts.body, fontWeight: 600 }}
          >
            Protect &amp; download
          </Button>
        </div>
      }
      styles={{ body: { fontFamily: fonts.body, paddingTop: 4 } }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleProtect();
        }}
      >
        <Text style={{ display: 'block', fontSize: fontSizes.sm, color: colors.textSecondary, marginBottom: 14, lineHeight: 1.5 }}>
          Downloads a password-protected copy of <Text strong>{documentName}</Text> with
          your edits. The document in Scopit stays unprotected, so you can keep editing it.
        </Text>

        {/* ── Password to open ── */}
        <div style={S.section(requireOpen)}>
          <Checkbox checked={requireOpen} onChange={(e) => setRequireOpen(e.target.checked)}>
            <Text strong style={{ fontSize: fontSizes.sm }}>Require a password to open the document</Text>
          </Checkbox>
          <Text style={S.sectionHint}>Nobody can see the contents without it.</Text>
          {requireOpen && (
            <div style={S.fields}>
              <Input.Password
                value={openPassword}
                onChange={(e) => setOpenPassword(e.target.value)}
                placeholder="Password"
                autoComplete="new-password"
                aria-label="Password to open the document"
                status={showErrors && openError && openPassword.length < MIN_PASSWORD_LENGTH ? 'error' : undefined}
              />
              <Input.Password
                value={openConfirm}
                onChange={(e) => setOpenConfirm(e.target.value)}
                placeholder="Confirm password"
                autoComplete="new-password"
                aria-label="Confirm the password to open the document"
                status={showErrors && openError ? 'error' : undefined}
              />
              {showErrors && openError && <span role="alert" style={S.fieldError}>{openError}</span>}
            </div>
          )}
        </div>

        {/* ── Permissions ── */}
        <div style={S.section(restrict)}>
          <Checkbox checked={restrict} onChange={(e) => setRestrict(e.target.checked)}>
            <Text strong style={{ fontSize: fontSizes.sm }}>Restrict editing and printing</Text>
          </Checkbox>
          <Text style={S.sectionHint}>
            PDF viewers hold back what you don&rsquo;t allow unless the permissions password is entered.
          </Text>
          {restrict && (
            <div style={S.fields}>
              <Input.Password
                value={permissionsPassword}
                onChange={(e) => setPermissionsPassword(e.target.value)}
                placeholder="Permissions password"
                autoComplete="new-password"
                aria-label="Permissions password"
                status={showErrors && permissionsError && permissionsPassword.length < MIN_PASSWORD_LENGTH ? 'error' : undefined}
              />
              <Input.Password
                value={permissionsConfirm}
                onChange={(e) => setPermissionsConfirm(e.target.value)}
                placeholder="Confirm permissions password"
                autoComplete="new-password"
                aria-label="Confirm the permissions password"
                status={showErrors && permissionsError ? 'error' : undefined}
              />
              {showErrors && permissionsError && (
                <span role="alert" style={S.fieldError}>{permissionsError}</span>
              )}

              <span style={S.label}>Allow</span>
              <div style={S.allowList} role="group" aria-label="Allowed actions">
                <Checkbox checked={allowPrinting} onChange={(e) => setAllowPrinting(e.target.checked)}>
                  Printing
                </Checkbox>
                <Checkbox checked={allowCopying} onChange={(e) => setAllowCopying(e.target.checked)}>
                  Copying text and images
                </Checkbox>
                <Checkbox checked={allowEditing} onChange={(e) => setAllowEditing(e.target.checked)}>
                  Changing pages
                </Checkbox>
                <Checkbox checked={allowCommenting} onChange={(e) => setAllowCommenting(e.target.checked)}>
                  Comments and form filling
                </Checkbox>
              </div>
              {allAllowed && (
                <Text style={{ fontSize: fontSizes.xs, color: colors.textMuted }}>
                  Everything is still allowed. Uncheck what you want to restrict.
                </Text>
              )}
            </div>
          )}
        </div>

        {showErrors && formError && (
          <Alert type="warning" showIcon message={formError} style={{ marginBottom: 4 }} />
        )}
        {/* Enter in a password field submits */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
};

export default ProtectModal;
