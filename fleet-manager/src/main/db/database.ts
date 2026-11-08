/**
 * Thin, typed wrapper around better-sqlite3.
 *
 * Owns the connection, applies migrations on open, and exposes small helpers used by the
 * repository layer. It intentionally contains no business logic so it can be unit-tested with
 * an in-memory database.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrations } from './migrations';

export type Row = Record<string, unknown>;

export class FleetDatabase {
  readonly db: Database.Database;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  /** Applies any migrations that have not yet been recorded. */
  migrate(): void {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
    );
    const applied = new Set(
      (this.db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id),
    );
    const record = this.db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
    const tx = this.db.transaction((fn: () => void) => fn());
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      tx(() => {
        migration.up(this.db);
        record.run(migration.id, Date.now());
      });
    }
  }

  run(sql: string, params: unknown[] = []): Database.RunResult {
    return this.db.prepare(sql).run(...(params as never[]));
  }

  get<T = Row>(sql: string, params: unknown[] = []): T | undefined {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  all<T = Row>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }

  /** Copies the database to `destination` using SQLite's online backup. */
  async backup(destination: string): Promise<void> {
    mkdirSync(dirname(destination), { recursive: true });
    await this.db.backup(destination);
  }
}
