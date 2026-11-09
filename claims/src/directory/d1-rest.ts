/**
 * Minimal Cloudflare D1 REST client for build-time reads.
 * API: POST /accounts/{account_id}/d1/database/{database_id}/query
 * The token needs only "D1: Read" on this account.
 */
export interface D1RestConfig {
  accountId: string;
  databaseId: string;
  token: string;
}

interface D1RestResponse<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result?: { success: boolean; results: T[] }[];
}

export async function queryD1<T>(
  cfg: D1RestConfig,
  sql: string,
  params: unknown[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<T[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfg.accountId)}/d1/database/${encodeURIComponent(cfg.databaseId)}/query`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  let body: D1RestResponse<T>;
  try {
    body = (await res.json()) as D1RestResponse<T>;
  } catch {
    throw new Error(`D1 REST query failed: HTTP ${res.status} with a non-JSON body.`);
  }
  if (!res.ok || !body.success || !body.result?.[0]?.success) {
    const msg = body.errors?.map((e) => `${e.code} ${e.message}`).join('; ') || `HTTP ${res.status}`;
    throw new Error(`D1 REST query failed: ${msg}`);
  }
  return body.result[0].results;
}
