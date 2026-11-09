/**
 * The subset of the Cloudflare D1 API this project uses. The real D1Database
 * binding satisfies it; tests use a node:sqlite shim (tests/helpers/d1-shim.ts).
 */
export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number };
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Like {
  prepare(sql: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<D1Result[]>;
}
