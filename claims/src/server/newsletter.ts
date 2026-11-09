/**
 * Newsletter signup behind one small adapter so the provider can be swapped.
 * Default: Buttondown (https://docs.buttondown.com/api-subscribers-create).
 *
 * Double opt-in: turn on "Require double opt-in / confirmation" in the
 * Buttondown newsletter settings. Subscribers created here are not marked as
 * already confirmed, so Buttondown sends its confirmation email and the
 * address is not added until the person clicks it.
 */
import { ConfigError, isProduction, type Env } from './env';

export interface NewsletterProvider {
  /** Resolves when the provider accepted the address (or already had it). */
  subscribe(email: string, opts: { referrerUrl?: string; ip?: string }): Promise<void>;
}

export class NewsletterError extends Error {}

export function createNewsletterProvider(env: Env, fetchImpl: typeof fetch = fetch): NewsletterProvider {
  const provider = (env.NEWSLETTER_PROVIDER || 'buttondown').toLowerCase();

  if (provider === 'log') {
    if (isProduction(env)) throw new ConfigError('NEWSLETTER_PROVIDER=log is not allowed in production.');
    return {
      async subscribe(email) {
        console.log(`[newsletter:log] would subscribe ${email} (double opt-in email would be sent)`);
      },
    };
  }

  if (provider !== 'buttondown') throw new ConfigError(`Unknown NEWSLETTER_PROVIDER "${provider}".`);
  const apiKey = env.BUTTONDOWN_API_KEY;
  if (!apiKey) throw new ConfigError('BUTTONDOWN_API_KEY is not set.');
  const tags = (env.BUTTONDOWN_TAGS || 'scopit-claims-adjuster-notes')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  return {
    async subscribe(email, opts) {
      const res = await fetchImpl('https://api.buttondown.com/v1/subscribers', {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email_address: email,
          tags,
          ...(opts.referrerUrl ? { referrer_url: opts.referrerUrl } : {}),
          ...(opts.ip ? { ip_address: opts.ip } : {}),
        }),
      });
      if (res.ok) return;
      const detail = await res.text().catch(() => '');
      // Already on the list: treat as success so we never reveal who is subscribed.
      if (res.status === 400 && /already|exists|duplicate/i.test(detail)) return;
      throw new NewsletterError(`Buttondown responded ${res.status}: ${detail.slice(0, 300)}`);
    },
  };
}
