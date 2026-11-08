# Architecture

This document explains how the Fleet Manager is put together and why. The README covers features
and usage; this covers the internal structure.

## Process model

```
┌──────────────────────────── Electron main (Node) ────────────────────────────┐
│  index.ts                                                                    │
│   ├─ AppContext ── db (SQLite) + repositories + services + event bus          │
│   ├─ ApiServer  ── local HTTP + WebSocket (/events), token auth              │
│   ├─ IPC handlers ── renderer <-> context                                     │
│   └─ WorkerSupervisor ── one child process per running bot                    │
│            └─ bot-worker (mineflayer) ── collectors ── role tasks             │
└──────────────────────────────────────────────────────────────────────────────┘
                    ▲ IPC (preload bridge)          ▲ fetch/WebSocket (API token)
                    │                               │
┌─────────────── renderer (React) ───────────────┐  └── external tools / automation
│  App shell, pages, store, typed API bridge     │
└────────────────────────────────────────────────┘
```

Each bot runs in its own Node child process (`src/main/mineflayer/bot-worker.ts`), supervised by
`WorkerSupervisor`. A bot that hangs, leaks or crashes is killed and restarted without taking the
UI or the other bots with it. The main process only exchanges small JSON messages with workers
(`protocol.ts`).

## Layering

| Layer | Responsibility | Electron-free? |
| --- | --- | --- |
| `db/` | SQLite schema, migrations, typed repositories | yes |
| `services/` | Domain logic (accounts, groups, instances, deployment, roles, hunter, stasis, equipment, events, diagnostics) | yes |
| `security/` | Credential vault | yes (keytar is optional) |
| `api/` | Local HTTP + WebSocket surface and its auth | yes |
| `mineflayer/` | Worker supervision and bot runtime | yes (workers only spawn at run time) |
| `ipc/` + `index.ts` | Electron glue | no |

`AppContext` (`context.ts`) constructs and wires everything. It is deliberately pure with respect
to Electron, which is what lets the integration tests build a complete, working context over an
in-memory database and exercise the real code paths.

## Data flow

- **Commands** flow renderer → preload bridge → IPC handler → service → repository/worker.
- **Events** flow service → `EventBus` → (a) IPC to the renderer and (b) WebSocket to API clients.
  The UI never polls; it re-renders from pushed events.
- **Persistence** is SQLite through typed repositories. Migrations run at startup and are versioned.

## Security

- Credentials never touch the database. `CredentialVault` stores secrets in the OS keychain via
  `keytar`, or in an AES-encrypted file when `keytar` is unavailable. The database only holds a
  reference to the stored secret.
- The renderer runs with `contextIsolation: true`, `nodeIntegration: false`; it can only reach
  main through the explicit preload API surface.
- The local API requires a bearer token, generated on first run and viewable/rotatable in the
  Configuration page.

## LogVex Hunter integration

`HunterClient` (`services/hunter/hunter-client.ts`) is the only place that talks to the addon. It:

- wraps `/health`, `/api/v1/snapshot`, `/api/v1/modules`, `/api/v1/players`, `/api/v1/command` and
  `/api/v1/notify` with a configurable timeout and a bearer token;
- degrades to "disconnected" on any failure instead of throwing into the UI;
- emits connect/disconnect so the store can reflect live status.

`TargetSync` uses the client to reconcile the local target database with a connected client.

## Extending

- **New service**: add it to `services/`, construct it in `AppContext`, expose it through an IPC
  handler and (optionally) an API route, and add tests under `tests/`.
- **New page**: add a component under `renderer/pages/`, register it in the `NAV`/`TITLES` maps in
  `App.tsx`, and add the corresponding `FleetApi` methods in `shared/ipc.ts` and the preload bridge.
- **New role**: add a definition in `services/roles/roles.ts`; the catalog, validation and
  deployment UI pick it up automatically.
