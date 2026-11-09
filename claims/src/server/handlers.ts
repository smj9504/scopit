/**
 * Request handlers for the public forms. Pages Functions in functions/api/
 * are thin wrappers around these so the logic can be tested without
 * Cloudflare and moved to another host.
 */
import { ConfigError, siteUrl, type Env } from './env';
import {
  clientIp,
  errorResponse,
  hashIp,
  HttpError,
  isAllowedOrigin,
  json,
  readJsonObject,
  validationError,
} from './http';
import { verifyTurnstile } from './turnstile';
import { allowRequest, type RateBucket } from './ratelimit';
import { validateApplication, validateInquiry, validateNewsletter } from './validate';
import {
  getContactableListings,
  hasOpenApplication,
  insertApplication,
  insertInquiry,
  purgeOldInquiries,
  setRecipientStatus,
} from './store';
import { createEmailSender, type EmailSender } from './email';
import { createNewsletterProvider } from './newsletter';
import {
  applicationAdminNotice,
  applicationConfirmation,
  inquiryConfirmation,
  inquiryToAdjuster,
} from './email-templates';
import { stateName } from '../shared/constants';
import { todayIso } from '../shared/dates';

export interface HandlerDeps {
  now?: Date;
  fetch?: typeof fetch;
  newId?: () => string;
  /** Lets the runtime finish background work (Cloudflare's waitUntil). */
  waitUntil?: (p: Promise<unknown>) => void;
}

const TURNSTILE_FAILED =
  'The spam check did not go through. Please wait a moment and try again, or reload the page.';
const RATE_LIMITED = 'Too many submissions from this connection. Please try again in an hour.';

type Ctx = { env: Env; ip: string; ipHash: string; deps: Required<Omit<HandlerDeps, 'waitUntil'>> & HandlerDeps };

async function guard(
  request: Request,
  env: Env,
  deps: HandlerDeps,
  bucket: RateBucket,
  /** overLimit() records one attempt and says whether the address is over its limit. Call it after validation. */
  run: (body: Record<string, unknown>, ctx: Ctx, overLimit: () => Promise<boolean>) => Promise<Response>,
): Promise<Response> {
  try {
    if (!isAllowedOrigin(request, env)) return errorResponse(403, 'This form can only be sent from the Scopit Claims site.');
    const body = await readJsonObject(request);
    const ip = clientIp(request);
    const ctx: Ctx = {
      env,
      ip,
      ipHash: await hashIp(ip, env.IP_HASH_SALT),
      deps: {
        now: deps.now ?? new Date(),
        fetch: deps.fetch ?? fetch,
        newId: deps.newId ?? (() => crypto.randomUUID()),
        waitUntil: deps.waitUntil,
      },
    };
    return await run(body, ctx, async () => !(await allowRequest(env.DB, bucket, ctx.ipHash, ctx.deps.now)));
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err.status, err.message);
    if (err instanceof ConfigError) {
      console.error(`[config] ${err.message}`);
      return errorResponse(503, 'This form is temporarily unavailable. Please try again later.');
    }
    console.error('[handler] unexpected error', err);
    return errorResponse(500, 'Something went wrong on our side. Please try again.');
  }
}

async function checkTurnstile(ctx: Ctx, token: string): Promise<boolean> {
  const result = await verifyTurnstile(ctx.env, token, ctx.ip, ctx.deps.fetch);
  return result.success;
}

/* ---------------- POST /api/inquiry ---------------- */

export function handleInquiry(request: Request, env: Env, deps: HandlerDeps = {}): Promise<Response> {
  return guard(request, env, deps, 'inquiry', async (body, ctx, overLimit) => {
    const parsed = validateInquiry(body);
    if (!parsed.ok) return validationError(parsed.errors);
    const input = parsed.value;
    if (await overLimit()) return errorResponse(429, RATE_LIMITED);

    if (!(await checkTurnstile(ctx, input.turnstileToken))) return errorResponse(400, TURNSTILE_FAILED);

    // Check the selection against live data: the page may be older than the latest approvals.
    const today = todayIso(ctx.deps.now);
    const found = await getContactableListings(env.DB, input.adjusters, today);
    if (found.length !== input.adjusters.length) {
      return validationError(
        { adjusters: 'One of the adjusters you chose is no longer listed. Reload the page and choose again.' },
        'One of the adjusters you chose is no longer listed.',
      );
    }
    const notLicensed = found.filter((r) => !r.listing.states.includes(input.propertyState));
    if (notLicensed.length) {
      return validationError({
        adjusters: `${notLicensed.map((r) => r.listing.businessName).join(', ')} ${notLicensed.length === 1 ? 'is' : 'are'} not listed with a verified license in ${stateName(input.propertyState)}. Choose adjusters licensed where the property is.`,
      });
    }

    const sender = createEmailSender(env, ctx.deps.fetch);
    const inquiryId = ctx.deps.newId();
    await insertInquiry(env.DB, input, found, { id: inquiryId, now: ctx.deps.now, ipHash: ctx.ipHash });

    const sent = await sendToAdjusters(env, sender, inquiryId, input, found);
    if (sent.length === 0) {
      return errorResponse(502, 'We could not send your message. Please try again in a few minutes.');
    }

    const followUp = (async () => {
      try {
        const confirmation = inquiryConfirmation(input, sent);
        await sender.send({ to: input.email, ...confirmation, idempotencyKey: `inquiry-confirm-${inquiryId}` });
      } catch (err) {
        console.error('[inquiry] confirmation email failed', err);
      }
      try {
        await purgeOldInquiries(env.DB, ctx.deps.now);
      } catch (err) {
        console.error('[inquiry] purge failed', err);
      }
    })();
    if (ctx.deps.waitUntil) ctx.deps.waitUntil(followUp);
    else await followUp;

    const failed = found.filter((f) => !sent.includes(f));
    return json({
      ok: true,
      sentTo: sent.map((s) => s.listing.businessName),
      failed: failed.map((f) => f.listing.businessName),
    });
  });
}

async function sendToAdjusters(
  env: Env,
  sender: EmailSender,
  inquiryId: string,
  input: Parameters<typeof inquiryToAdjuster>[0],
  recipients: Awaited<ReturnType<typeof getContactableListings>>,
) {
  const results = await Promise.all(
    recipients.map(async (r) => {
      try {
        const msg = inquiryToAdjuster(input, r);
        const { id } = await sender.send({
          to: r.email,
          ...msg,
          replyTo: input.email,
          idempotencyKey: `inquiry-${inquiryId}-${r.listing.id}`,
        });
        await setRecipientStatus(env.DB, inquiryId, r.listing.id, 'sent', id);
        return r;
      } catch (err) {
        console.error(`[inquiry] send to ${r.listing.slug} failed`, err);
        await setRecipientStatus(env.DB, inquiryId, r.listing.id, 'failed', null).catch(() => {});
        return null;
      }
    }),
  );
  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

/* ---------------- POST /api/apply ---------------- */

export function handleApply(request: Request, env: Env, deps: HandlerDeps = {}): Promise<Response> {
  return guard(request, env, deps, 'apply', async (body, ctx, overLimit) => {
    const today = todayIso(ctx.deps.now);
    const parsed = validateApplication(body, today);
    if (!parsed.ok) return validationError(parsed.errors);
    const input = parsed.value;
    if (await overLimit()) return errorResponse(429, RATE_LIMITED);

    if (!(await checkTurnstile(ctx, input.turnstileToken))) return errorResponse(400, TURNSTILE_FAILED);

    if (await hasOpenApplication(env.DB, input.email)) {
      return validationError(
        { email: 'We already have an application or listing for this email. Email us if you need to change it.' },
        'We already have an application for this email.',
      );
    }

    const sender = createEmailSender(env, ctx.deps.fetch);
    const id = ctx.deps.newId();
    await insertApplication(env.DB, input, { id, now: ctx.deps.now, ipHash: ctx.ipHash });

    const notify = (async () => {
      try {
        await sender.send({ to: input.email, ...applicationConfirmation(input), idempotencyKey: `apply-confirm-${id}` });
      } catch (err) {
        console.error('[apply] confirmation email failed', err);
      }
      if (env.ADMIN_NOTIFY_EMAIL) {
        try {
          await sender.send({
            to: env.ADMIN_NOTIFY_EMAIL,
            ...applicationAdminNotice(input, siteUrl(env, `/admin/listings/${id}`)),
            idempotencyKey: `apply-admin-${id}`,
          });
        } catch (err) {
          console.error('[apply] admin notice failed', err);
        }
      }
    })();
    if (ctx.deps.waitUntil) ctx.deps.waitUntil(notify);
    else await notify;

    return json({ ok: true });
  });
}

/* ---------------- POST /api/newsletter ---------------- */

export function handleNewsletter(request: Request, env: Env, deps: HandlerDeps = {}): Promise<Response> {
  return guard(request, env, deps, 'newsletter', async (body, ctx, overLimit) => {
    const parsed = validateNewsletter(body);
    if (!parsed.ok) return validationError(parsed.errors);
    if (await overLimit()) return errorResponse(429, RATE_LIMITED);
    if (!(await checkTurnstile(ctx, parsed.value.turnstileToken))) return errorResponse(400, TURNSTILE_FAILED);

    const provider = createNewsletterProvider(env, ctx.deps.fetch);
    try {
      await provider.subscribe(parsed.value.email, { referrerUrl: siteUrl(env, '/for-adjusters/') });
    } catch (err) {
      console.error('[newsletter] subscribe failed', err);
      return errorResponse(502, 'We could not sign you up just now. Please try again later.');
    }
    return json({ ok: true });
  });
}
