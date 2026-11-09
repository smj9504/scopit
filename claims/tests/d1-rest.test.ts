import { describe, expect, it } from 'vitest';
import { queryD1 } from '../src/directory/d1-rest';

const cfg = { accountId: 'acct', databaseId: 'db', token: 'tok' };

describe('build-time D1 REST reader', () => {
  it('posts the SQL with a bearer token and returns rows', async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const fake = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return Response.json({ success: true, result: [{ success: true, results: [{ id: 'x' }] }] });
    }) as unknown as typeof fetch;
    const rows = await queryD1<{ id: string }>(cfg, 'SELECT 1', [], fake);
    expect(rows).toEqual([{ id: 'x' }]);
    expect(seen!.url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/d1/database/db/query');
    expect((seen!.init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('throws (failing the build) on API errors instead of returning an empty directory', async () => {
    const fake = (async () =>
      Response.json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, { status: 403 })) as unknown as typeof fetch;
    await expect(queryD1(cfg, 'SELECT 1', [], fake)).rejects.toThrow(/Authentication error/);
  });
});
