/**
 * Newsletter signup behind one small adapter so the provider can be swapped.
 * Default: Buttondown (https://docs.buttondown.com/api-subscribers-create).
 *
 * Double opt-in: Buttondown applies it by default to subscribers created
 * through the API (they get a confirmation email and stay "unactivated" until
 * they click it). It is skipped only if the request sends type "regular",
 * which this adapter never does. Unknown fields are rejected by Buttondown
 * (422), so only documented fields are sent.
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
      // Already on the list (Buttondown answers 400 email_already_exists; 409 is
      // also documented): treat as success so we never reveal who is subscribed.
      if ((res.status === 400 || res.status === 409) && /already|exists|duplicate/i.test(detail)) return;
      throw new NewsletterError(`Buttondown responded ${res.status}: ${detail.slice(0, 300)}`);
    },
  };
}
