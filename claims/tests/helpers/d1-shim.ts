/**
 * In-memory D1 stand-in built on node:sqlite, loaded with the real
 * migrations, so store and handler tests run the same SQL as production.
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { D1Like, D1PreparedStatementLike, D1Result } from '../../src/server/d1';

type Param = string | number | bigint | null | Uint8Array;

export function createTestDb(): D1Like & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const dir = join(import.meta.dirname, '../../migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    raw.exec(readFileSync(join(dir, file), 'utf8'));
  }

  const toParams = (values: unknown[]): Param[] =>
    values.map((v) => {
      if (v === undefined) throw new Error('D1 does not accept undefined bind values');
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v as Param;
    });

  const plain = <T>(row: unknown): T => (row ? ({ ...(row as object) } as T) : (row as T));

  class Stmt implements D1PreparedStatementLike {
    constructor(
      readonly sql: string,
      readonly params: Param[] = [],
    ) {}
    bind(...values: unknown[]) {
      return new Stmt(this.sql, toParams(values));
    }
    async first<T>() {
      const row = raw.prepare(this.sql).get(...this.params);
      return row ? plain<T>(row) : null;
    }
    async all<T>(): Promise<D1Result<T>> {
      const rows = raw.prepare(this.sql).all(...this.params);
      return { results: rows.map((r) => plain<T>(r)), success: true, meta: {} };
    }
    async run(): Promise<D1Result> {
      const r = raw.prepare(this.sql).run(...this.params);
      return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    }
    runSync(): D1Result {
      const r = raw.prepare(this.sql).run(...this.params);
      return { results: [], success: true, meta: { changes: Number(r.changes) } };
    }
  }

  return {
    raw,
    prepare: (sql: string) => new Stmt(sql),
    async batch(statements) {
      raw.exec('BEGIN');
      try {
        const out = statements.map((s) => (s as Stmt).runSync());
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
