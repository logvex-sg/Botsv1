# Changelog

All notable changes to **Logvex Fleet Manager** (the desktop application) are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Multiverse: organisational layer & statistics

The Host grew the half of the product that is about *organisation* rather than live control: named
server profiles, reusable presets, schedules, event-driven automation, a container ledger and an
append-only audit trail — plus a statistics page that reports only what the Host actually recorded.

### Added
- **Multiverse page** (`src/renderer/pages/multiverse/`) — one page, seven tabs: Servers,
  Templates, Task presets, Schedules, Automation, Containers and Audit. Each tab reads and writes
  through the real Host service over the preload bridge; there are no placeholder controls.
- **`MultiverseService`** (`src/main/services/multiverse/multiverse-service.ts`) — the single code
  path behind every tab: `listServers`/`createServer`/`updateServer`/`removeServer`/`assignServer`,
  `listGroupTemplates`/`createGroupFromTemplate`, `listTaskPresets`/`runTaskPreset`, schedules
  (`createSchedule`, `missedFor`, `tickSchedules`), automation rules, container records,
  inventory history (`inventoryTrend`, `inventoryCaptures`), tags and `listAudit`.
- **Statistics package** (`src/main/packages/statistics/`) — a pure, unit-tested `buildStatistics`
  that turns the Host's own records (workers, tasks, commands, events, inventory, schedules, rules,
  containers, audit) into one report, and a `statisticsToCsv` exporter that mirrors it exactly.
- **Statistics page** (`src/renderer/pages/StatisticsPage.tsx`) — worker counts by status/group/
  version, task outcomes (completion, failure, average duration) over finished tasks only, a 24-hour
  activity histogram, breakdowns by kind/status/actor and event/audit action, and inventory totals.
  A metric with no data reads **"no data"**, never a zero. Export the report as JSON or CSV.
- **HTTP routes** — `/api/v1/servers`, `/api/v1/templates`, `/api/v1/presets`,
  `POST /api/v1/presets/{id}/run`, `/api/v1/schedules`, `/api/v1/rules`, `/api/v1/containers`,
  `/api/v1/audit`, `/api/v1/tags` and `/api/v1/statistics`.
- **IPC** — `stats:get` and `stats:export` channels, with a save-dialog export on the main process.

### Notes
- The Host remains a control plane: it never joins a world, so it never reports combat. The
  statistics page says so plainly rather than inventing a kill count.

### Tests
- `tests/unit/statistics.test.ts` — 8 tests: empty-fleet "no data" behaviour, worker/status/group
  breakdowns, completion and failure over finished tasks, inventory aggregation, activity bucketing,
  schedule and rule totals, percentage formatting and CSV escaping.
- Two API tests covering the multiverse collections and the statistics report shape.
- Suite: **262 tests**.

## [Unreleased] — Simplicity & user experience overhaul

A ground-up redesign of the interface around three goals: **simplicity, ease of use and
reliability**. Nothing was removed from the backend; the same features are now reachable with far
less effort, and the app explains itself.

### Added
- **Guided setup advisor** (`src/main/services/setup/setup-advisor.ts`) — a pure, unit-tested module
  that inspects the fleet and returns an ordered checklist (add a server → add an account → connect
  the Hunter addon → start your bots), a completion percentage and a plain-language "next step"
  hint.
- **One-click operations** exposed through new IPC channels and context methods:
  - `quickSetup` — creates a server profile and an account in a single step.
  - `quickDeploy` — builds and launches a deployment for the chosen accounts. Combat is **never**
    armed implicitly: HUNTER accounts require `authorizeCombat: true`, and an unauthorised request
    is refused with an explanation rather than silently started.
  - `setupReport` — the data behind the Dashboard checklist.
- **Beginner / Advanced modes** (`uiMode` setting). Beginner mode hides the deployment queue, role
  configuration and technical settings behind plain-language screens; Advanced mode reveals them.
  The mode is switchable from the top bar and from Settings.
- **Light theme** in addition to the dark theme, persisted in `theme` and applied through CSS
  variables on `<html data-theme>`.
- **New navigation** — seven focused sections (Dashboard, Main Features, Tasks, Accounts, Activity,
  Settings, Help) replacing twelve. Old page ids (`?page=overview`, `?page=deployment`, …) are
  accepted as aliases so existing links keep working.
- **New pages**: Dashboard (setup checklist, one-click start, live fleet state, recent activity),
  Main Features (Hunter / Targets / Gear / Stasis / Servers behind tabs), Tasks (beginner pick-and-
  start flow plus the advanced builder and monitor), Activity (events + statistics + logs) and Help
  (short guide, glossary, FAQ).
- **Friendly error handling** (`src/renderer/lib/errors.ts`) — technical failures are mapped to a
  plain-language title and a suggested fix, with a **Copy technical details** button for debugging.
  Unit-tested.
- **UI primitives**: progress ring, callout, tooltip, segmented control, confirmation dialog,
  empty state and error notice.
- **Responsive layout** — the sidebar collapses and grids reflow below 760 px.

### Changed
- Settings are grouped and explained, with tooltips on every non-obvious option and a **Restore
  defaults** button. Technical options moved into an Advanced section.
- Every destructive action (stop everything, delete, regenerate key, restore defaults) now asks for
  confirmation first.
- The Dashboard is now the landing page and explains what to do next without a manual.

### Fixed
- Corrected the `AppSettings` demo fixture and settings save path so theme/mode changes persist in
  demo mode.

### Tests
- Added `tests/unit/setup-advisor.test.ts` (guided setup report + quick-setup/quick-deploy
  behaviour, including the combat-safety guarantee) and `tests/unit/renderer-errors.test.ts`
  (friendly error mapping). Suite: **132 tests**.

## [Unreleased] — Worker fleet management

Adds a **Fleet** section: the app can now host a worker WebSocket server and drive a fleet of
**Logvex Worker** client mods (see `worker-mod/`). The worker protocol is a closed set of message
types and task kinds; the host never sends code, and a protocol-version or token mismatch is refused
at the handshake.

### Added
- **Worker WebSocket server** (`src/main/workers/worker-server.ts`) — binds loopback by default,
  authenticates workers with a shared token, assigns a stable id, tracks the last snapshot and
  online state, and answers tasks with a per-task timeout. `WorkerService` is the single code path
  for every fleet operation.
- **Worker protocol mirror** (`src/shared/workers.ts`) — the TypeScript counterpart of
  `worker-mod/.../Protocol.java`, with a defensive envelope decoder that drops malformed frames
  instead of throwing.
- **Worker persistence** (`worker_groups`, `worker_tasks`, `worker_commands`, `worker_inventory`,
  `regear_presets`, plus the `workers` table) and typed repositories.
- **Fleet UI** — a new top-level **Fleet** section with seven tabs: Dashboard, Workers, Groups,
  Tasks, Inventory, Commands and Regear. The Workers tab has a per-worker inspector with live state
  and controls (refresh, pull inventory, ask position, command, chat, ping, kick, forget). Label,
  group and notes are host-side only.
- **Item counting across the fleet** with the same forgiving query matching the worker uses
  (`totem`, `gapple`, `diamond`, …), scoped to a group, with a staleness flag based on the capture
  time.
- **Regear presets and comparison** — a per-worker gap report against a preset, and a fleet sweep.
  Moves are **off** by default (a dry run that only reports).
- **HTTP worker routes** — `/api/v1/workers`, `/api/v1/workers/overview`,
  `/api/v1/workers/{id}/task`, `/api/v1/workers/{id}/line`, `/api/v1/workers/{id}/inventory`,
  `/api/v1/workers/count`, and the groups/tasks/commands/presets lists.
- **Settings → Worker server** — enable/disable, host, port, and the shared token with a reveal and
  a regenerate button.

### Fixed
- **Stale-connection teardown.** When a worker reconnected with the same id, the replaced socket's
  `close` handler could delete the *fresh* connection from the live map, leaving the worker
  permanently offline. The close handler now only cleans up the socket that still owns the entry.
- **Heartbeat no longer clobbers inventory.** A `STATUS` frame used to fall through into the
  `INVENTORY` branch, overwriting the stored inventory with an empty snapshot on every heartbeat.
- **Deterministic history order.** Task and command lists now break same-millisecond ties by
  `rowid`, so the newest row is always first for a burst of activity.
- The envelope decoder now rejects a non-object payload (such as an array) instead of trusting it.

### Tests
- `tests/support/fake-worker.ts` — a worker-shaped WebSocket client that speaks the same protocol
  as the mod, so protocol drift fails the build.
- `tests/integration/workers.test.ts` — 25 tests driving that client against the real server:
  handshake accept/refuse, reconnect replacement, task round-trip, timeout, refusal propagation,
  conflicting-task rejection, inventory caching, group-scoped counting, command audit, regear gaps,
  malformed-frame robustness, disconnect handling and selector resolution.
- `tests/unit/worker-protocol.test.ts` and `tests/unit/worker-repositories.test.ts`.
- Worker HTTP route tests in `tests/integration/api-server.test.ts`.
- Suite: **178 tests**.

## [1.0.0] - 2026-11-08

Initial release. Logvex Fleet Manager is an Electron + React + TypeScript desktop application for
running and supervising a fleet of Minecraft bot instances and connecting to LogVex Hunter clients.

### Added

#### Application shell
- Electron main process with an isolated context, a local HTTP + WebSocket API, and an IPC bridge
  exposed to the renderer through a hardened preload script.
- React single-page UI with a sectioned sidebar, a top bar with the emergency-stop control and a
  notification count, and a toast system.

#### Command Center
- **Overview** — fleet health, instance counts, connection states, recent events and live
  notifications.
- **Deployment Center** — build deployments from accounts, a server profile and roles; validate,
  preview, start, pause, resume, cancel and retry; export/import presets; duplicate a deployment.
- **Instance Manager** — create, start, stop, restart and command instances; per-instance logs and
  metrics.
- **Account Manager** — offline/Microsoft/Mojang accounts with keychain-backed credential storage
  (encrypted-file fallback) and login preparation.

#### Bot Roles
- **Gearer Manager** — equipment profiles and inventory evaluation.
- **Stasis Manager** — stasis locations with state transitions (READY/UNAVAILABLE/ACTIVE/UNKNOWN/
  ERROR) and a change history.
- **Hunter Manager** — connection health, live snapshot (bot, players, targets, modules, stats) and
  remote commands for LogVex Hunter clients.

#### Data
- **Target Database** — local target list with bidirectional sync to connected Hunter clients.
- **Event Center** — searchable event stream and notification inbox.
- **Server Profiles** — server definitions with connection diagnostics.

#### System
- **Configuration** — application settings, API token management and full configuration
  import/export.
- **Logs & Statistics** — aggregated logs and statistics.

#### Infrastructure
- Isolated Node worker process per bot, supervised so a crash or hang cannot take down the app.
- SQLite persistence with versioned migrations and typed repositories.
- Event bus feeding the UI over IPC and the API over WebSocket.
- Vitest unit and integration suites (110 tests) covering repositories, services, the deployment
  engine, the API server, the Hunter client and security.

[1.0.0]: https://github.com/logvex-sg/Botsv1/releases/tag/fleet-manager-v1.0.0
