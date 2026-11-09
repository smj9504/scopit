// POST /api/inquiry — a homeowner's message to the adjusters they selected.
import { handleInquiry } from '../../src/server/handlers';
import { methodNotAllowed } from '../../src/server/http';
import type { PagesContext } from '../../src/server/pages';

export const onRequest = (ctx: PagesContext): Promise<Response> | Response =>
  ctx.request.method === 'POST'
    ? handleInquiry(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) })
    : methodNotAllowed('POST');
