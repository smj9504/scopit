/**
 * Transactional email behind one small interface. Default provider: Resend
 * (https://resend.com/docs/api-reference/emails/send-email). Set
 * EMAIL_PROVIDER=log for local work to print emails instead of sending them.
 *
 * This site only ever sends:
 *   - an inquiry to each adjuster the homeowner selected,
 *   - a confirmation to the homeowner who sent that inquiry,
 *   - a confirmation to a PA who applied, and a notice to the admin,
 *   - a notice to the PA when their listing goes live.
 * Nothing else. No marketing email to homeowners, ever.
 */
import { ConfigError, isProduction, type Env } from './env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  /** Prevents duplicate sends if a request is retried. */
  idempotencyKey?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<{ id: string | null }>;
}

export class EmailSendError extends Error {}

export function createEmailSender(env: Env, fetchImpl: typeof fetch = fetch): EmailSender {
  const provider = (env.EMAIL_PROVIDER || 'resend').toLowerCase();

  if (provider === 'log') {
    if (isProduction(env)) throw new ConfigError('EMAIL_PROVIDER=log is not allowed in production.');
    return {
      async send(message) {
        console.log(
          `[email:log] to=${message.to} subject=${JSON.stringify(message.subject)}${message.replyTo ? ` reply-to=${message.replyTo}` : ''}\n${message.text}\n[email:log] end`,
        );
        return { id: null };
      },
    };
  }

  if (provider !== 'resend') throw new ConfigError(`Unknown EMAIL_PROVIDER "${provider}".`);
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from) throw new ConfigError('RESEND_API_KEY and EMAIL_FROM must be set.');

  return {
    async send(message) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };
      if (message.idempotencyKey) headers['Idempotency-Key'] = message.idempotencyKey;
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new EmailSendError(`Resend responded ${res.status}: ${detail.slice(0, 300)}`);
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      return { id: data.id ?? null };
    },
  };
}
