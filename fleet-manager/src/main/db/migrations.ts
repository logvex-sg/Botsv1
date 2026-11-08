/**
 * Ordered, append-only database migrations.
 *
 * Each migration is a pure function over a SQLite database. The runner records the applied
 * `id` in `schema_migrations`, so migrations only ever run once and the schema can evolve
 * without data loss.
 */
import type BetterSqlite3 from 'better-sqlite3';

export interface Migration {
  id: string;
  up: (db: BetterSqlite3.Database) => void;
}

export const migrations: Migration[] = [
  {
    id: '0001_initial',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS groups (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT '#6d5efc',
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS server_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          host TEXT NOT NULL,
          port INTEGER NOT NULL DEFAULT 25565,
          version TEXT NOT NULL DEFAULT '',
          auth_mode TEXT NOT NULL DEFAULT 'offline',
          connection_timeout_ms INTEGER NOT NULL DEFAULT 15000,
          options TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          display_name TEXT NOT NULL DEFAULT '',
          auth_mode TEXT NOT NULL DEFAULT 'offline',
          role TEXT NOT NULL DEFAULT 'HUNTER',
          group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
          last_login INTEGER,
          last_login_ok INTEGER NOT NULL DEFAULT 0,
          server_profile_id TEXT REFERENCES server_profiles(id) ON DELETE SET NULL,
          notes TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);

        CREATE TABLE IF NOT EXISTS instances (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'HUNTER',
          group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
          server_profile_id TEXT REFERENCES server_profiles(id) ON DELETE SET NULL,
          config TEXT NOT NULL DEFAULT '{}',
          priority INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS deployment_configs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          server_profile_id TEXT REFERENCES server_profiles(id) ON DELETE SET NULL,
          entries TEXT NOT NULL DEFAULT '[]',
          max_concurrent INTEGER NOT NULL DEFAULT 1,
          connection_timeout_ms INTEGER NOT NULL DEFAULT 15000,
          retry_attempts INTEGER NOT NULL DEFAULT 2,
          retry_delay_ms INTEGER NOT NULL DEFAULT 5000,
          manual_approval INTEGER NOT NULL DEFAULT 0,
          pause_between_ms INTEGER NOT NULL DEFAULT 5000,
          resource_limit_mb INTEGER NOT NULL DEFAULT 4096,
          notify_on_event INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS deployment_queue (
          id TEXT PRIMARY KEY,
          deployment_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          instance_name TEXT NOT NULL,
          role TEXT NOT NULL,
          role_config TEXT NOT NULL DEFAULT '{}',
          position INTEGER NOT NULL,
          stage TEXT NOT NULL DEFAULT 'WAITING',
          attempts INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          started_at INTEGER,
          finished_at INTEGER,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS targets (
          id TEXT PRIMARY KEY,
          uuid TEXT,
          username TEXT NOT NULL,
          display_name TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'TEMPORARY',
          priority INTEGER NOT NULL DEFAULT 5,
          notes TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          source TEXT NOT NULL DEFAULT 'fleet',
          last_seen INTEGER,
          encounters INTEGER NOT NULL DEFAULT 0,
          kills INTEGER NOT NULL DEFAULT 0,
          deaths INTEGER NOT NULL DEFAULT 0,
          last_position TEXT,
          dimension TEXT NOT NULL DEFAULT '',
          updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_targets_identity
          ON targets(COALESCE(uuid, lower(username)));

        CREATE TABLE IF NOT EXISTS stasis_locations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          instance_id TEXT,
          server_profile_id TEXT,
          dimension TEXT NOT NULL DEFAULT '',
          x REAL NOT NULL DEFAULT 0,
          y REAL NOT NULL DEFAULT 0,
          z REAL NOT NULL DEFAULT 0,
          state TEXT NOT NULL DEFAULT 'UNKNOWN',
          last_activity INTEGER,
          last_verified INTEGER,
          last_error TEXT,
          config TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS equipment_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          server_profile_id TEXT,
          weapons TEXT NOT NULL DEFAULT '[]',
          min_armor_pieces INTEGER NOT NULL DEFAULT 4,
          min_totems INTEGER NOT NULL DEFAULT 1,
          min_food INTEGER NOT NULL DEFAULT 8,
          low_durability_percent INTEGER NOT NULL DEFAULT 15,
          sort_order TEXT NOT NULL DEFAULT '[]',
          warning_thresholds TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          source TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'info',
          instance_id TEXT,
          account_id TEXT,
          target_uuid TEXT,
          message TEXT NOT NULL,
          payload TEXT NOT NULL DEFAULT '{}',
          timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);

        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          type TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'info',
          title TEXT NOT NULL,
          body TEXT NOT NULL DEFAULT '',
          read INTEGER NOT NULL DEFAULT 0,
          timestamp INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    id: '0002_config_history',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS config_versions (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          ref_id TEXT NOT NULL DEFAULT '',
          version INTEGER NOT NULL,
          data TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_config_versions_scope
          ON config_versions(scope, ref_id, version DESC);
      `);
    },
  },
];
