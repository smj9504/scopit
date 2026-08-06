/**
 * ScopeIt - Sign Request Detail
 *
 * Full detail view for a single e-signature request, including:
 *  - Document & recipient information
 *  - Contextual action buttons
 *  - Full audit trail timeline
 *
 * Usage:
 *   <SignRequestDetail requestId={id} onBack={() => setDetailId(null)} />
 */
import React, { useCallback } from 'react';
import {
  Button,
  Card,
  Descriptions,
  Timeline,
  Tag,
  Space,
  Typography,
  Spin,
  App,
  Popconfirm,
} from 'antd';
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  CloseCircleOutlined,
  LinkOutlined,
  BellOutlined,
  CheckCircleOutlined,
  SendOutlined,
  EyeOutlined,
  StopOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  EditOutlined,
  UserOutlined,
  MailOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pdfEditorApi } from './pdfEditorApi';
import type { SignRequest, SignAuditEvent } from './types';
import { colors, fonts, fontSizes, fontWeights, borderRadius, spacing } from '@/styles/theme';

const { Text, Title } = Typography;

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:             { label: 'Draft',            color: '#6b7280' },
  sent:              { label: 'Sent',              color: '#3b82f6' },
  viewed:            { label: 'Viewed',            color: '#8b5cf6' },
  partially_signed:  { label: 'Partially Signed',  color: '#f59e0b' },
  signed:            { label: 'Signed',            color: '#10b981' },
  declined:          { label: 'Declined',          color: '#ef4444' },
  expired:           { label: 'Expired',           color: '#f59e0b' },
  cancelled:         { label: 'Voided',            color: '#6b7280' },
};

const RECIPIENT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending:  { label: 'Pending',  color: '#6b7280' },
  sent:     { label: 'Sent',     color: '#3b82f6' },
  viewed:   { label: 'Viewed',   color: '#8b5cf6' },
  signed:   { label: 'Signed',   color: '#10b981' },
  declined: { label: 'Declined', color: '#ef4444' },
};

// ── Audit event config ────────────────────────────────────────────────────────

interface AuditEventConfig {
  label: string;
  icon: React.ReactNode;
  dotColor: string;
}

function getAuditEventConfig(eventType: string): AuditEventConfig {
  const iconStyle = { fontSize: 14 };

  const map: Record<string, AuditEventConfig> = {
    created: {
      label: 'Created',
      icon: <FileTextOutlined style={iconStyle} />,
      dotColor: colors.textSecondary,
    },
    sent: {
      label: 'Sent',
      icon: <SendOutlined style={iconStyle} />,
      dotColor: colors.info,
    },
    viewed: {
      label: 'Viewed',
      icon: <EyeOutlined style={iconStyle} />,
      dotColor: '#8b5cf6',
    },
    signed: {
      label: 'Signed',
      icon: <CheckCircleOutlined style={iconStyle} />,
      dotColor: colors.success,
    },
    declined: {
      label: 'Declined',
      icon: <StopOutlined style={iconStyle} />,
      dotColor: colors.error,
    },
    voided: {
      label: 'Voided',
      icon: <CloseCircleOutlined style={iconStyle} />,
      dotColor: colors.textMuted,
    },
    cancelled: {
      label: 'Voided',
      icon: <CloseCircleOutlined style={iconStyle} />,
      dotColor: colors.textMuted,
    },
    expired: {
      label: 'Expired',
      icon: <ClockCircleOutlined style={iconStyle} />,
      dotColor: colors.warning,
    },
    reminder_sent: {
      label: 'Reminder Sent',
      icon: <BellOutlined style={iconStyle} />,
      dotColor: colors.textSecondary,
    },
    signed_copy_sent: {
      label: 'Signed Copy Emailed',
      icon: <MailOutlined style={iconStyle} />,
      dotColor: colors.success,
    },
    completed: {
      label: 'Completed',
      icon: <CheckCircleOutlined style={iconStyle} />,
      dotColor: colors.success,
    },
    send_failed: {
      label: 'Send Failed',
      icon: <CloseCircleOutlined style={iconStyle} />,
      dotColor: colors.error,
    },
  };

  return (
    map[eventType] ?? {
      label: eventType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      icon: <FileTextOutlined style={iconStyle} />,
      dotColor: colors.textMuted,
    }
  );
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SignRequestDetailProps {
  requestId: string;
  onBack: () => void;
  /** Hide the internal "Back to Sign Requests" button when the host already
   * provides its own way out (e.g. a Drawer's close icon) -- PdfEditorTool
   * swaps this in as a full view with no other nav, so it keeps the default. */
  showBackButton?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

const SignRequestDetail: React.FC<SignRequestDetailProps> = ({ requestId, onBack, showBackButton = true }) => {
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  // Fetch sign request
  const {
    data: req,
    isLoading: reqLoading,
    isError: reqError,
  } = useQuery<SignRequest>({
    queryKey: ['sign-request', requestId],
    queryFn: () => pdfEditorApi.getSignRequest(requestId),
  });

  // Fetch audit trail
  const { data: auditEvents = [], isLoading: auditLoading } = useQuery<SignAuditEvent[]>({
    queryKey: ['sign-audit', requestId],
    queryFn: () => pdfEditorApi.getSignAudit(requestId),
    enabled: !!req,
  });

  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: () => pdfEditorApi.cancelSignRequest(requestId),
    onSuccess: () => {
      message.success('Sign request voided');
      queryClient.invalidateQueries({ queryKey: ['sign-request', requestId] });
      queryClient.invalidateQueries({ queryKey: ['sign-audit', requestId] });
      queryClient.invalidateQueries({ queryKey: ['sign-requests'] });
    },
    onError: () => message.error('Failed to void sign request'),
  });

  // Download signed document
  const handleDownload = useCallback(async () => {
    if (!req) return;
    try {
      const blob = await pdfEditorApi.downloadSignedDocument(requestId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const baseName = req.documentName
        ? req.documentName.replace(/\.[^.]+$/, '')
        : `document_${requestId}`;
      a.download = `${baseName}_signed.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error('Failed to download signed document');
    }
  }, [req, requestId, message]);

  // Copy one recipient's signing link
  const handleCopyLink = useCallback(
    (url: string) => {
      navigator.clipboard
        .writeText(url)
        .then(() => message.success('Signing link copied to clipboard'))
        .catch(() => message.error('Failed to copy link'));
    },
    [message],
  );

  // Send reminder (all outstanding recipients, or a single one)
  const reminderMutation = useMutation({
    mutationFn: (recipientId?: string) => pdfEditorApi.sendReminder(requestId, recipientId),
    onSuccess: (_data, recipientId) => {
      message.success(recipientId ? 'Reminder sent' : 'Reminder sent to all outstanding recipients');
      queryClient.invalidateQueries({ queryKey: ['sign-audit', requestId] });
    },
    onError: () => message.error('Failed to send reminder'),
  });

  // Re-send the signed PDF by email to the sender and every recipient
  const resendSignedCopyMutation = useMutation({
    mutationFn: () => pdfEditorApi.resendSignedCopy(requestId),
    onSuccess: () => {
      message.success('Signed copy emailed to the sender and all recipients');
      queryClient.invalidateQueries({ queryKey: ['sign-audit', requestId] });
    },
    onError: () => message.error('Failed to email the signed copy'),
  });

  // ── Loading / error states ────────────────────────────────────────────────

  if (reqLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 320,
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  if (reqError || !req) {
    return (
      <div style={{ padding: spacing[6] }}>
        {showBackButton && (
          <Button icon={<ArrowLeftOutlined />} type="text" onClick={onBack} style={{ marginBottom: spacing[4] }}>
            Back to Sign Requests
          </Button>
        )}
        <Text type="danger">Failed to load sign request. Please try again.</Text>
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const statusCfg = STATUS_CONFIG[req.status] ?? { label: req.status, color: colors.textMuted };
  const activeStatuses = ['sent', 'viewed', 'partially_signed'];
  const canCancel = activeStatuses.includes(req.status);
  const canDownload = req.status === 'signed';
  const canReminder = activeStatuses.includes(req.status)
    && req.recipients.some((r) => r.status === 'sent' || r.status === 'viewed');

  const recipientById = new Map(req.recipients.map((r) => [r.id, r]));

  // ── Audit timeline items ──────────────────────────────────────────────────

  const timelineItems = auditEvents.map((event) => {
    const cfg = getAuditEventConfig(event.eventType);
    const meta = event.eventMetadata as Record<string, string | undefined>;

    return {
      key: event.id,
      dot: (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: `${cfg.dotColor}18`,
            color: cfg.dotColor,
            border: `1.5px solid ${cfg.dotColor}40`,
          }}
        >
          {cfg.icon}
        </span>
      ),
      children: (
        <div style={{ paddingBottom: spacing[2] }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: spacing[2],
              marginBottom: 2,
            }}
          >
            <Text
              strong
              style={{
                fontSize: fontSizes.sm,
                color: colors.textPrimary,
                fontFamily: fonts.body,
              }}
            >
              {cfg.label}
            </Text>
            <Text
              style={{
                fontSize: fontSizes.xs,
                color: colors.textMuted,
                fontFamily: fonts.body,
              }}
            >
              {formatDateTime(event.createdAt)}
            </Text>
          </div>

          {event.actorEmail && (
            <Text
              style={{
                display: 'block',
                fontSize: fontSizes.xs,
                color: colors.textSecondary,
                fontFamily: fonts.body,
              }}
            >
              By: {event.actorEmail}
              {event.recipientId && recipientById.get(event.recipientId) && (
                <> ({recipientById.get(event.recipientId)!.role})</>
              )}
            </Text>
          )}

          {event.actorIp && (
            <Text
              style={{
                display: 'block',
                fontSize: fontSizes.xs,
                color: colors.textMuted,
                fontFamily: fonts.body,
              }}
            >
              IP: {event.actorIp}
            </Text>
          )}

          {/* Extra metadata */}
          {meta.signature_type && (
            <Text
              style={{
                display: 'block',
                fontSize: fontSizes.xs,
                color: colors.textMuted,
                fontFamily: fonts.body,
              }}
            >
              Type:{' '}
              <span style={{ textTransform: 'capitalize' }}>
                {String(meta.signature_type)}
              </span>
            </Text>
          )}

          {meta.reason && (
            <Text
              style={{
                display: 'block',
                fontSize: fontSizes.xs,
                color: colors.textMuted,
                fontFamily: fonts.body,
              }}
            >
              Reason: {String(meta.reason)}
            </Text>
          )}
        </div>
      ),
    };
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        width: '100%',
        padding: `${spacing[4]} ${spacing[4]}`,
        fontFamily: fonts.body,
      }}
    >
      {/* Back button */}
      {showBackButton && (
        <Button
          icon={<ArrowLeftOutlined />}
          type="text"
          onClick={onBack}
          style={{
            marginBottom: spacing[5],
            padding: `0 ${spacing[2]}`,
            height: 32,
            color: colors.textSecondary,
            fontFamily: fonts.body,
            fontSize: fontSizes.sm,
          }}
        >
          Back to Sign Requests
        </Button>
      )}

      {/* Page title */}
      <div style={{ marginBottom: spacing[5] }}>
        <Title
          level={4}
          style={{
            margin: 0,
            fontFamily: fonts.heading,
            fontWeight: fontWeights.semibold,
            color: colors.textPrimary,
            fontSize: fontSizes.xl,
          }}
        >
          Sign Request
        </Title>
      </div>

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* Document info */}
        <Card
          size="small"
          title={
            <span
              style={{
                fontFamily: fonts.body,
                fontWeight: fontWeights.semibold,
                fontSize: fontSizes.sm,
                color: colors.textPrimary,
              }}
            >
              <FileTextOutlined style={{ marginRight: 8, color: colors.textMuted }} />
              Document
            </span>
          }
          styles={{
            body: { padding: `${spacing[3]} ${spacing[4]}` },
            header: {
              borderBottom: `1px solid ${colors.border}`,
              minHeight: 40,
              padding: `0 ${spacing[4]}`,
            },
          }}
          style={{
            borderRadius: borderRadius.lg,
            border: `1px solid ${colors.border}`,
          }}
        >
          <Descriptions
            column={2}
            size="small"
            labelStyle={{
              color: colors.textSecondary,
              fontSize: fontSizes.xs,
              fontFamily: fonts.body,
              fontWeight: fontWeights.medium,
              width: 100,
            }}
            contentStyle={{
              color: colors.textPrimary,
              fontSize: fontSizes.sm,
              fontFamily: fonts.body,
            }}
          >
            <Descriptions.Item label="Document" span={2}>
              {req.documentName ?? <Text type="secondary">—</Text>}
            </Descriptions.Item>

            <Descriptions.Item label="Status">
              <Tag
                style={{
                  color: statusCfg.color,
                  background: `${statusCfg.color}18`,
                  border: `1px solid ${statusCfg.color}40`,
                  borderRadius: borderRadius.sm,
                  fontFamily: fonts.body,
                  fontSize: fontSizes.xs,
                  fontWeight: fontWeights.medium,
                  lineHeight: '20px',
                  padding: `0 ${spacing[2]}`,
                }}
              >
                {statusCfg.label}
              </Tag>
            </Descriptions.Item>

            <Descriptions.Item label="Sent">
              {formatDate(req.sentAt)}
            </Descriptions.Item>

            {req.signedAt && (
              <Descriptions.Item label="Signed">
                {formatDate(req.signedAt)}
              </Descriptions.Item>
            )}

            {req.declinedAt && (
              <Descriptions.Item label="Declined">
                {formatDate(req.declinedAt)}
              </Descriptions.Item>
            )}

            {req.expiresAt && (
              <Descriptions.Item label="Expires">
                {formatDate(req.expiresAt)}
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>

        {/* Recipients */}
        <Card
          size="small"
          title={
            <span
              style={{
                fontFamily: fonts.body,
                fontWeight: fontWeights.semibold,
                fontSize: fontSizes.sm,
                color: colors.textPrimary,
              }}
            >
              <UserOutlined style={{ marginRight: 8, color: colors.textMuted }} />
              {req.recipients.length === 1 ? 'Recipient' : `Recipients (${req.recipients.length})`}
            </span>
          }
          styles={{
            body: { padding: 0 },
            header: {
              borderBottom: `1px solid ${colors.border}`,
              minHeight: 40,
              padding: `0 ${spacing[4]}`,
            },
          }}
          style={{
            borderRadius: borderRadius.lg,
            border: `1px solid ${colors.border}`,
          }}
        >
          {req.recipients.map((recipient, index) => {
            const rCfg = RECIPIENT_STATUS_CONFIG[recipient.status] ?? {
              label: recipient.status,
              color: colors.textMuted,
            };
            const canRemindThis = recipient.status === 'sent' || recipient.status === 'viewed';
            const signUrl = req.signUrls?.[recipient.id];

            return (
              <div
                key={recipient.id}
                style={{
                  padding: `${spacing[3]} ${spacing[4]}`,
                  borderBottom: index < req.recipients.length - 1 ? `1px solid ${colors.border}` : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: spacing[3],
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: 2 }}>
                    <Text
                      strong
                      style={{ fontFamily: fonts.body, fontSize: fontSizes.sm, color: colors.textPrimary }}
                    >
                      {recipient.name}
                    </Text>
                    <Tag
                      style={{
                        margin: 0,
                        color: colors.textSecondary,
                        background: colors.bgSunken,
                        border: `1px solid ${colors.border}`,
                        borderRadius: borderRadius.sm,
                        fontFamily: fonts.body,
                        fontSize: fontSizes.xs,
                        lineHeight: '18px',
                      }}
                    >
                      {recipient.role}
                    </Tag>
                  </div>
                  <Text style={{ fontFamily: fonts.body, fontSize: fontSizes.xs, color: colors.textSecondary }}>
                    {recipient.email}
                    {recipient.signedAt && ` · Signed ${formatDate(recipient.signedAt)}`}
                    {!recipient.signedAt && recipient.viewedAt && ` · Viewed ${formatDate(recipient.viewedAt)}`}
                    {!recipient.signedAt && recipient.declinedAt && ` · Declined ${formatDate(recipient.declinedAt)}`}
                  </Text>
                </div>

                <Space size={8}>
                  <Tag
                    style={{
                      margin: 0,
                      color: rCfg.color,
                      background: `${rCfg.color}18`,
                      border: `1px solid ${rCfg.color}40`,
                      borderRadius: borderRadius.sm,
                      fontFamily: fonts.body,
                      fontSize: fontSizes.xs,
                      fontWeight: fontWeights.medium,
                      lineHeight: '20px',
                    }}
                  >
                    {rCfg.label}
                  </Tag>
                  {signUrl && (
                    <Button
                      size="small"
                      type="text"
                      icon={<LinkOutlined />}
                      onClick={() => handleCopyLink(signUrl)}
                      style={{ fontFamily: fonts.body, fontSize: fontSizes.xs, color: colors.textSecondary }}
                    >
                      Copy Link
                    </Button>
                  )}
                  {canRemindThis && (
                    <Button
                      size="small"
                      type="text"
                      icon={<BellOutlined />}
                      loading={reminderMutation.isPending}
                      onClick={() => reminderMutation.mutate(recipient.id)}
                      style={{ fontFamily: fonts.body, fontSize: fontSizes.xs, color: colors.textSecondary }}
                    >
                      Remind
                    </Button>
                  )}
                </Space>
              </div>
            );
          })}
        </Card>

        {/* Sender */}
        <Card
          size="small"
          title={
            <span
              style={{
                fontFamily: fonts.body,
                fontWeight: fontWeights.semibold,
                fontSize: fontSizes.sm,
                color: colors.textPrimary,
              }}
            >
              <EditOutlined style={{ marginRight: 8, color: colors.textMuted }} />
              Sender
            </span>
          }
          styles={{
            body: { padding: `${spacing[3]} ${spacing[4]}` },
            header: {
              borderBottom: `1px solid ${colors.border}`,
              minHeight: 40,
              padding: `0 ${spacing[4]}`,
            },
          }}
          style={{
            borderRadius: borderRadius.lg,
            border: `1px solid ${colors.border}`,
          }}
        >
          <Descriptions
            column={2}
            size="small"
            labelStyle={{
              color: colors.textSecondary,
              fontSize: fontSizes.xs,
              fontFamily: fonts.body,
              fontWeight: fontWeights.medium,
              width: 100,
            }}
            contentStyle={{
              color: colors.textPrimary,
              fontSize: fontSizes.sm,
              fontFamily: fonts.body,
            }}
          >
            <Descriptions.Item label="Name">
              {req.senderName || <Text type="secondary">—</Text>}
            </Descriptions.Item>

            <Descriptions.Item label="Email">
              {req.senderEmail}
            </Descriptions.Item>
          </Descriptions>
        </Card>

        {/* Actions */}
        {(canDownload || canCancel || canReminder || true) && (
          <Card
            size="small"
            title={
              <span
                style={{
                  fontFamily: fonts.body,
                  fontWeight: fontWeights.semibold,
                  fontSize: fontSizes.sm,
                  color: colors.textPrimary,
                }}
              >
                Actions
              </span>
            }
            styles={{
              body: { padding: `${spacing[3]} ${spacing[4]}` },
              header: {
                borderBottom: `1px solid ${colors.border}`,
                minHeight: 40,
                padding: `0 ${spacing[4]}`,
              },
            }}
            style={{
              borderRadius: borderRadius.lg,
              border: `1px solid ${colors.border}`,
            }}
          >
            <Space wrap>
              {canDownload && (
                <Button
                  icon={<DownloadOutlined />}
                  type="primary"
                  onClick={handleDownload}
                  style={{
                    fontFamily: fonts.body,
                    fontWeight: fontWeights.medium,
                    fontSize: fontSizes.sm,
                    background: colors.primary,
                    borderColor: colors.primary,
                  }}
                >
                  Download Signed PDF
                </Button>
              )}

              {canDownload && (
                <Button
                  icon={<MailOutlined />}
                  onClick={() => resendSignedCopyMutation.mutate()}
                  loading={resendSignedCopyMutation.isPending}
                  style={{
                    fontFamily: fonts.body,
                    fontWeight: fontWeights.medium,
                    fontSize: fontSizes.sm,
                  }}
                >
                  Email Signed Copy
                </Button>
              )}

              {canReminder && (
                <Button
                  icon={<BellOutlined />}
                  onClick={() => reminderMutation.mutate(undefined)}
                  loading={reminderMutation.isPending}
                  style={{
                    fontFamily: fonts.body,
                    fontWeight: fontWeights.medium,
                    fontSize: fontSizes.sm,
                  }}
                >
                  Remind All Outstanding
                </Button>
              )}

              {canCancel && (
                <Popconfirm
                  title="Void this sign request?"
                  description="No recipient will be able to sign this document after voiding."
                  okText="Void Request"
                  cancelText="Keep"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => cancelMutation.mutate()}
                >
                  <Button
                    icon={<CloseCircleOutlined />}
                    danger
                    loading={cancelMutation.isPending}
                    style={{
                      fontFamily: fonts.body,
                      fontWeight: fontWeights.medium,
                      fontSize: fontSizes.sm,
                    }}
                  >
                    Void Request
                  </Button>
                </Popconfirm>
              )}
            </Space>
          </Card>
        )}

        {/* Audit trail */}
        <Card
          size="small"
          title={
            <span
              style={{
                fontFamily: fonts.body,
                fontWeight: fontWeights.semibold,
                fontSize: fontSizes.sm,
                color: colors.textPrimary,
              }}
            >
              Audit Trail
            </span>
          }
          styles={{
            body: { padding: `${spacing[6]} ${spacing[5]}` },
            header: {
              borderBottom: `1px solid ${colors.border}`,
              minHeight: 40,
              padding: `0 ${spacing[4]}`,
            },
          }}
          style={{
            borderRadius: borderRadius.lg,
            border: `1px solid ${colors.border}`,
          }}
        >
          {auditLoading ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: `${spacing[8]} 0`,
              }}
            >
              <Spin />
            </div>
          ) : timelineItems.length === 0 ? (
            <Text
              style={{
                color: colors.textMuted,
                fontSize: fontSizes.sm,
                fontFamily: fonts.body,
              }}
            >
              No audit events recorded yet.
            </Text>
          ) : (
            <Timeline items={timelineItems} />
          )}
        </Card>
      </Space>
    </div>
  );
};

export default SignRequestDetail;
