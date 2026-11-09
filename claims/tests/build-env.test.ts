import { describe, expect, it } from 'vitest';
import { loadBuildEnv } from '../scripts/build-env.mjs';

describe('Cloudflare build settings from wrangler.toml', () => {
  it('does nothing outside Cloudflare', () => {
    const env: Record<string, string> = {};
    expect(loadBuildEnv(env)).toBeNull();
    expect(env).toEqual({});
  });

  it('uses the production block on the production branch, keeping values already set', () => {
    const env: Record<string, string> = { CF_PAGES: '1', CF_PAGES_BRANCH: 'main', PUBLIC_CONTACT_EMAIL: 'set@dashboard.test' };
    expect(loadBuildEnv(env)).toBe('production');
    expect(env.CLAIMS_ENV).toBe('production');
    expect(env.CLAIMS_DIRECTORY_SOURCE).toBe('d1');
    expect(env.CF_D1_DATABASE_ID).toMatch(/^[0-9a-f-]{36}$/);
    expect(env.PUBLIC_CONTACT_EMAIL).toBe('set@dashboard.test');
  });

  it('uses the preview block on any other branch', () => {
    const env: Record<string, string> = { CF_PAGES: '1', CF_PAGES_BRANCH: 'claude/some-branch' };
    expect(loadBuildEnv(env)).toBe('preview');
    expect(env.CLAIMS_ENV).toBe('preview');
    expect(env.NEWSLETTER_PROVIDER).toBe('log');
  });
});
