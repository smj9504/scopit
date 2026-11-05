/**
 * Scopit - Contact Support Modal
 *
 * The in-app Help form. A signed-in user picks a topic and writes a message;
 * it is saved and emailed to the Scopit team, who reply to the account email.
 * The page the user is on goes along with it, so the team can see what they
 * see.
 *
 * Mounted once in AppLayout and kept mounted while closed, so a half-written
 * message survives closing the modal by accident. It clears once sent.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Input, Modal } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { CheckCircleFilled } from '@ant-design/icons';
import axios from 'axios';
import { useAuthStore } from '@/stores/authStore';
import { getErrorMessage } from '@/services/api';
import { supportService, type InquiryCategory } from '@/services/supportService';
import { colors, fonts } from '@/styles/theme';

/** Public support address, offered when the form itself can't send. */
export const SUPPORT_EMAIL = 'help@scopit.work';

const MESSAGE_MAX_LENGTH = 5000;

const TOPICS: { value: InquiryCategory; label: string; placeholder: string }[] = [
  { value: 'question', label: 'Question', placeholder: 'What would you like to know?' },
  {
    value: 'problem',
    label: 'Problem',
    placeholder: 'What happened, and what did you expect to happen?',
  },
  { value: 'idea', label: 'Idea', placeholder: 'What would make Scopit work better for you?' },
  { value: 'other', label: 'Other', placeholder: 'How can we help?' },
];

function sendErrorText(error: unknown): string {
  if (axios.isAxiosError(error) && !error.response) {
    return 'Check your internet connection and try again.';
  }
  return getErrorMessage(error);
}

interface ContactSupportModalProps {
  open: boolean;
  onClose: () => void;
}

const ContactSupportModal: React.FC<ContactSupportModalProps> = ({ open, onClose }) => {
  const location = useLocation();
  const accountEmail = useAuthStore((s) => s.user?.email);
  const textAreaRef = useRef<TextAreaRef>(null);
  const doneRef = useRef<HTMLButtonElement>(null);

  const [category, setCategory] = useState<InquiryCategory>('question');
  const [message, setMessage] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  // The form is replaced by the confirmation; keep focus inside the modal
  // (Escape and Tab only work there) by moving it to Done.
  useEffect(() => {
    if (sentTo) doneRef.current?.focus();
  }, [sentTo]);

  const send = useMutation({
    mutationFn: () =>
      supportService.sendInquiry({
        category,
        message: message.trim(),
        pageUrl: `${location.pathname}${location.search}`,
      }),
    onSuccess: (result) => {
      setSentTo(result.replyTo);
      setMessage('');
      setCategory('question');
    },
  });

  const canSend = message.trim().length > 0 && !send.isPending;
  const topic = TOPICS.find((t) => t.value === category) ?? TOPICS[0];

  const handleSend = () => {
    if (canSend) send.mutate();
  };

  const footer = sentTo
    ? [
        <Button key="done" type="primary" ref={doneRef} onClick={onClose}>
          Done
        </Button>,
      ]
    : [
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button
          key="send"
          type="primary"
          onClick={handleSend}
          // Loading (not disabled) while sending, so focus stays on it.
          loading={send.isPending}
          disabled={message.trim().length === 0}
        >
          Send message
        </Button>,
      ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Contact Scopit"
      footer={footer}
      width={520}
      afterOpenChange={(isOpen) => {
        if (isOpen) {
          if (!sentTo) textAreaRef.current?.focus({ cursor: 'end' });
          return;
        }
        // Closed: drop the confirmation and any error. An unsent draft stays.
        setSentTo(null);
        send.reset();
      }}
    >
      {sentTo ? (
        <div role="status" style={{ textAlign: 'center', padding: '16px 8px 8px' }}>
          <CheckCircleFilled style={{ fontSize: 40, color: colors.success }} aria-hidden />
          <h2
            style={{
              margin: '16px 0 8px',
              fontFamily: fonts.heading,
              fontSize: 20,
              fontWeight: 700,
              color: colors.textPrimary,
            }}
          >
            Message sent
          </h2>
          <p style={{ margin: 0, color: colors.textSecondary, fontSize: 15, lineHeight: 1.6 }}>
            Thanks for writing. We'll reply by email to{' '}
            <strong style={{ color: colors.textPrimary, wordBreak: 'break-all' }}>{sentTo}</strong>.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 }}>
          <p style={{ margin: 0, color: colors.textSecondary, fontSize: 14, lineHeight: 1.6 }}>
            Ask a question, report a problem, or share an idea. We reply by email.
          </p>

          <div>
            <div
              id="support-topic-label"
              style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary, marginBottom: 8 }}
            >
              Topic
            </div>
            <div
              role="group"
              aria-labelledby="support-topic-label"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
            >
              {TOPICS.map((t) => {
                const active = t.value === category;
                return (
                  <button
                    key={t.value}
                    type="button"
                    className="support-topic"
                    aria-pressed={active}
                    onClick={() => setCategory(t.value)}
                    style={{
                      height: 36,
                      padding: '0 16px',
                      borderRadius: 9999,
                      border: `1px solid ${active ? colors.primary : colors.borderDark}`,
                      background: active ? colors.primary : colors.bgWhite,
                      color: active ? colors.textWhite : colors.textPrimary,
                      fontSize: 14,
                      fontWeight: 500,
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="support-message"
              style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 600,
                color: colors.textPrimary,
                marginBottom: 8,
              }}
            >
              Message
            </label>
            <Input.TextArea
              id="support-message"
              ref={textAreaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                // Ctrl/Cmd+Enter sends, like most message boxes.
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={topic.placeholder}
              autoSize={{ minRows: 5, maxRows: 12 }}
              maxLength={MESSAGE_MAX_LENGTH}
              showCount={message.length > MESSAGE_MAX_LENGTH * 0.8}
              // Read-only rather than disabled while sending: disabling would
              // drop keyboard focus out of the modal.
              readOnly={send.isPending}
            />
          </div>

          {send.isError && (
            <Alert
              type="error"
              showIcon
              message="Your message wasn't sent"
              description={
                <>
                  {sendErrorText(send.error)} You can also email us at{' '}
                  <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
                </>
              }
            />
          )}

          <p style={{ margin: 0, color: colors.textMuted, fontSize: 13, lineHeight: 1.55 }}>
            {accountEmail ? (
              <>
                We'll reply to <span style={{ color: colors.textSecondary }}>{accountEmail}</span>.{' '}
              </>
            ) : null}
            Your message includes the page you're on and your browser type, to help us look into
            it.
          </p>
        </div>
      )}
    </Modal>
  );
};

export default ContactSupportModal;
