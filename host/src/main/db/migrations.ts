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
  {
    id: '0003_workers',
    up: (db) => {
      db.exec(`
        -- A worker is a Minecraft client running the logvex-worker mod. The live connection lives
        -- in memory; this row is the durable record so the host remembers a worker across restarts
        -- (its id, last known state and group).
        CREATE TABLE IF NOT EXISTS workers (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL DEFAULT '',
          username TEXT NOT NULL DEFAULT '',
          minecraft_version TEXT NOT NULL DEFAULT '',
          server_address TEXT NOT NULL DEFAULT '',
          protocol_version INTEGER NOT NULL DEFAULT 0,
          mod_version TEXT NOT NULL DEFAULT '',
          group_id TEXT REFERENCES worker_groups(id) ON DELETE SET NULL,
          notes TEXT NOT NULL DEFAULT '',
          first_seen INTEGER NOT NULL,
          last_seen INTEGER NOT NULL,
          last_address TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'OFFLINE',
          snapshot TEXT NOT NULL DEFAULT '{}'
        );

        -- Worker groups are separate from bot groups: a bot group labels an account the host
        -- launches, a worker group labels a client that connected to the host.
        CREATE TABLE IF NOT EXISTS worker_groups (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT '#6d5efc',
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS worker_tasks (
          id TEXT PRIMARY KEY,
          worker_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          params TEXT NOT NULL DEFAULT '{}',
          result TEXT,
          error TEXT,
          created_at INTEGER NOT NULL,
          dispatched_at INTEGER,
          completed_at INTEGER,
          duration_ms INTEGER,
          actor TEXT NOT NULL DEFAULT 'host'
        );
        CREATE INDEX IF NOT EXISTS idx_worker_tasks_worker ON worker_tasks(worker_id, created_at DESC);

        -- Every command or chat line a worker was asked to send, so an operator can audit exactly
        -- what the fleet did and when.
        CREATE TABLE IF NOT EXISTS worker_commands (
          id TEXT PRIMARY KEY,
          worker_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          line TEXT NOT NULL,
          ok INTEGER NOT NULL DEFAULT 0,
          response TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_worker_commands_worker ON worker_commands(worker_id, created_at DESC);

        -- A named equipment loadout the host can assign to a worker or a group.
        CREATE TABLE IF NOT EXISTS regear_presets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          items TEXT NOT NULL DEFAULT '[]',
          min_armor_pieces INTEGER NOT NULL DEFAULT 0,
          min_food INTEGER NOT NULL DEFAULT 0,
          low_durability_percent INTEGER NOT NULL DEFAULT 10,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        -- The latest inventory a worker reported, kept so the host can count items and diff
        -- inventories without asking again. Clearly a *reported* snapshot, never a live view.
        CREATE TABLE IF NOT EXISTS worker_inventory (
          worker_id TEXT PRIMARY KEY,
          captured_at INTEGER NOT NULL,
          carried TEXT NOT NULL DEFAULT '[]',
          accessible TEXT NOT NULL DEFAULT '[]',
          armor TEXT NOT NULL DEFAULT '[]',
          container_open INTEGER NOT NULL DEFAULT 0
        );
      `);
    },
  },
  {
    id: '0004_host_schema',
    up: (db) => {
      // The mineflayer-era fleet (accounts, servers, deployments, instances, targets, stasis and
      // the role system) was removed in the rewrite: the host only manages real Minecraft clients
      // that dial in. The worker tables are unchanged; this migration rebuilds the two tables whose
      // shape followed the old domain and drops the rest.
      db.exec(`
        DROP TABLE IF EXISTS deployment_queue;
        DROP TABLE IF EXISTS deployment_configs;
        DROP TABLE IF EXISTS stasis_locations;
        DROP TABLE IF EXISTS equipment_profiles;
        DROP TABLE IF EXISTS targets;
        DROP TABLE IF EXISTS instances;
        DROP TABLE IF EXISTS accounts;
        DROP TABLE IF EXISTS server_profiles;
        DROP TABLE IF EXISTS groups;
        DROP TABLE IF EXISTS events;
        DROP TABLE IF EXISTS notifications;

        -- Events are now scoped to a worker (or null for host-level events).
        CREATE TABLE events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'host',
          severity TEXT NOT NULL DEFAULT 'info',
          worker_id TEXT,
          message TEXT NOT NULL DEFAULT '',
          payload TEXT NOT NULL DEFAULT '{}',
          timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_time ON events(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_events_worker ON events(worker_id, timestamp DESC);

        CREATE TABLE notifications (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          type TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'info',
          title TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          read INTEGER NOT NULL DEFAULT 0,
          timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_time ON notifications(timestamp DESC);
      `);
    },
  },
  {
    id: '0005_multiverse',
    up: (db) => {
      // The Multiverse layer: server profiles, worker tags, reusable task presets, schedules,
      // automation rules, inventory history and an audit trail. These are the durable records the
      // new engines (task-engine, scheduler, inventory-engine, group-engine) read and write.
      db.exec(`
        -- A server profile is an *organisational record*: a name, an address and notes. It is NOT
        -- proof the server is reachable. Reachability comes from what a worker reports.
        CREATE TABLE IF NOT EXISTS server_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          host TEXT NOT NULL DEFAULT '',
          port INTEGER NOT NULL DEFAULT 25565,
          version TEXT NOT NULL DEFAULT '',
          environment TEXT NOT NULL DEFAULT 'production',
          notes TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          archived INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        -- A worker may have one primary group and any number of tags. Tags are a JSON array on the
        -- worker row so membership needs no join; group_id stays the single primary group.
        ALTER TABLE workers ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE workers ADD COLUMN server_profile_id TEXT;
        ALTER TABLE workers ADD COLUMN fabric_version TEXT NOT NULL DEFAULT '';
        ALTER TABLE workers ADD COLUMN meteor_version TEXT NOT NULL DEFAULT '';
        ALTER TABLE workers ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE workers ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

        -- Group templates: reusable defaults a new group can be created from. Applying one never
        -- touches existing workers.
        CREATE TABLE IF NOT EXISTS group_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT '#6d5efc',
          default_task_preset_ids TEXT NOT NULL DEFAULT '[]',
          default_equipment_preset_ids TEXT NOT NULL DEFAULT '[]',
          permissions TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL
        );

        -- Group-level defaults and permissions (the template's applied result).
        ALTER TABLE worker_groups ADD COLUMN default_task_preset_ids TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE worker_groups ADD COLUMN default_equipment_preset_ids TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE worker_groups ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE worker_groups ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

        -- Reusable task configurations.
        CREATE TABLE IF NOT EXISTS task_presets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL,
          params TEXT NOT NULL DEFAULT '{}',
          target_worker_ids TEXT NOT NULL DEFAULT '[]',
          target_group_ids TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        -- Schedules. The state columns implement duplicate-run protection across restarts.
        CREATE TABLE IF NOT EXISTS schedules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          preset_id TEXT,
          kind TEXT NOT NULL,
          task_kind TEXT NOT NULL,
          params TEXT NOT NULL DEFAULT '{}',
          target_worker_ids TEXT NOT NULL DEFAULT '[]',
          target_group_ids TEXT NOT NULL DEFAULT '[]',
          schedule_kind TEXT NOT NULL,
          start_at INTEGER NOT NULL,
          interval_ms INTEGER,
          time_of_day TEXT,
          stop_at INTEGER,
          enabled INTEGER NOT NULL DEFAULT 1,
          last_fired_at INTEGER,
          fire_count INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);

        -- Automation rules: WHEN <event> AND <conditions> THEN <action>.
        CREATE TABLE IF NOT EXISTS automation_rules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          event TEXT NOT NULL,
          conditions TEXT NOT NULL DEFAULT '[]',
          action TEXT NOT NULL,
          cooldown_ms INTEGER NOT NULL DEFAULT 0,
          max_runs INTEGER,
          run_count INTEGER NOT NULL DEFAULT 0,
          last_run_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        -- Inventory history: one row per (worker, capture), so trends and diffs are real.
        CREATE TABLE IF NOT EXISTS inventory_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          worker_id TEXT NOT NULL,
          captured_at INTEGER NOT NULL,
          item_id TEXT NOT NULL,
          item_name TEXT NOT NULL DEFAULT '',
          count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_history ON inventory_history(worker_id, captured_at DESC);
        CREATE INDEX IF NOT EXISTS idx_inventory_history_item ON inventory_history(item_id, captured_at DESC);

        -- Accessible containers a worker has reported, kept separately from player inventories.
        CREATE TABLE IF NOT EXISTS containers (
          id TEXT PRIMARY KEY,
          worker_id TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          x INTEGER NOT NULL DEFAULT 0,
          y INTEGER NOT NULL DEFAULT 0,
          z INTEGER NOT NULL DEFAULT 0,
          dimension TEXT NOT NULL DEFAULT '',
          items TEXT NOT NULL DEFAULT '[]',
          inspected_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_containers_worker ON containers(worker_id, inspected_at DESC);

        -- An audit trail of every action the Host took, separate from the worker-scoped events.
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          at INTEGER NOT NULL,
          actor TEXT NOT NULL DEFAULT 'operator',
          action TEXT NOT NULL,
          target TEXT NOT NULL DEFAULT '',
          detail TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(at DESC);
      `);
    },
  },
];
