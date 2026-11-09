// POST /api/apply — a public adjuster's listing application.
import { handleApply } from '../../src/server/handlers';
import { methodNotAllowed } from '../../src/server/http';
import type { PagesContext } from '../../src/server/pages';

export const onRequest = (ctx: PagesContext): Promise<Response> | Response =>
  ctx.request.method === 'POST'
    ? handleApply(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) })
    : methodNotAllowed('POST');
