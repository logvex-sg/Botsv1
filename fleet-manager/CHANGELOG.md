# Changelog

All notable changes to **Logvex Fleet Manager** (the desktop application) are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
