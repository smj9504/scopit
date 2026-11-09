import type { Env } from './env';

const BASE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Robots-Tag': 'noindex',
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_HEADERS, ...headers },
  });
}

export type FieldErrors = Record<string, string>;

export function validationError(errors: FieldErrors, message = 'Please fix the highlighted fields.'): Response {
  return json({ ok: false, message, errors }, 422);
}

export function errorResponse(status: number, message: string): Response {
  return json({ ok: false, message }, status);
}

export function methodNotAllowed(allow: string): Response {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: allow, ...BASE_HEADERS } });
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Read a small JSON object body. Rejects other content types and large bodies. */
export async function readJsonObject(request: Request, maxBytes = 16_000): Promise<Record<string, unknown>> {
  const type = request.headers.get('Content-Type') || '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Send the form as JSON.');
  }
  const declared = Number(request.headers.get('Content-Length') || '0');
  if (declared > maxBytes) throw new HttpError(413, 'That submission is too large.');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'That submission is too large.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'We could not read that submission.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'We could not read that submission.');
  }
  return parsed as Record<string, unknown>;
}

/** Visitor IP as seen by Cloudflare. */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || '';
}

/**
 * Reject cross-site POSTs. Browsers always send Origin on fetch POSTs; it must
 * be this site (the request's own origin or the configured public origin).
 */
export function isAllowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  const allowed = new Set<string>([new URL(request.url).origin]);
  if (env.CLAIMS_SITE) {
    try {
      allowed.add(new URL(env.CLAIMS_SITE).origin);
    } catch {
      /* ignore a malformed setting */
    }
  }
  return allowed.has(origin);
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Salted hash of an IP, so rate limiting works without storing raw IPs. */
export async function hashIp(ip: string, salt: string | undefined): Promise<string> {
  if (!ip) return 'unknown';
  return (await sha256Hex(`${salt || 'scopit-claims-dev-salt'}:${ip}`)).slice(0, 32);
}
