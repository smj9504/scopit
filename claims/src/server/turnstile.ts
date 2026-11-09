/**
 * Cloudflare Turnstile server-side check.
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
import { ConfigError, isProduction, type Env } from './env';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Cloudflare's documented test secret that always passes. Never used in production. */
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

export interface TurnstileResult {
  success: boolean;
  codes: string[];
}

export async function verifyTurnstile(
  env: Env,
  token: string,
  ip: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  let secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (isProduction(env)) throw new ConfigError('TURNSTILE_SECRET_KEY is not set.');
    secret = TURNSTILE_TEST_SECRET;
  }
  if (!token) return { success: false, codes: ['missing-input-response'] };

  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);

  try {
    const res = await fetchImpl(VERIFY_URL, { method: 'POST', body });
    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    return { success: data.success === true, codes: data['error-codes'] ?? [] };
  } catch {
    return { success: false, codes: ['internal-error'] };
  }
}
