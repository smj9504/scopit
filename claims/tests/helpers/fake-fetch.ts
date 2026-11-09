/** Records outbound calls and answers like Turnstile, Resend, and Buttondown. */
export interface Call {
  url: string;
  init: RequestInit | undefined;
  body: unknown;
}

export function createFakeFetch(opts: { turnstileOk?: boolean; resendFailFor?: string[]; buttondownStatus?: number } = {}) {
  const calls: Call[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* keep string */
      }
    } else if (body instanceof FormData) {
      body = Object.fromEntries(body.entries());
    }
    calls.push({ url, init, body });

    if (url.includes('turnstile')) {
      const ok = opts.turnstileOk ?? true;
      return Response.json({ success: ok, 'error-codes': ok ? [] : ['invalid-input-response'] });
    }
    if (url.startsWith('https://api.resend.com/')) {
      const to = (body as { to?: string[] }).to?.[0] ?? '';
      if (opts.resendFailFor?.includes(to)) return new Response('boom', { status: 500 });
      return Response.json({ id: `em_${calls.length}` });
    }
    if (url.startsWith('https://api.buttondown.com/')) {
      const status = opts.buttondownStatus ?? 201;
      return new Response(status === 201 ? '{}' : '{"code":"email_already_exists","detail":"already exists"}', { status });
    }
    if (url.startsWith('https://api.cloudflare.com/client/v4/pages/webhooks/')) {
      return Response.json({ success: true });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  const emails = () =>
    calls
      .filter((c) => c.url.startsWith('https://api.resend.com/'))
      .map((c) => c.body as { to: string[]; subject: string; text: string; reply_to?: string; from: string });

  return { fetch: fakeFetch, calls, emails };
}
