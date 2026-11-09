// /admin and everything under it: the listing verification tool (Basic auth).
import { handleAdmin } from '../../src/server/admin';
import type { PagesContext } from '../../src/server/pages';

export const onRequest = (ctx: PagesContext): Promise<Response> =>
  handleAdmin(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) });
