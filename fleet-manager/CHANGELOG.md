# Changelog

All notable changes to **Logvex Fleet Manager** (the desktop application) are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
