/**
 * The parts of the Cloudflare Pages Functions context this project uses.
 * Declared here so no Cloudflare type package is needed.
 */
import type { Env } from './env';

export interface PagesContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  waitUntil(promise: Promise<unknown>): void;
}
