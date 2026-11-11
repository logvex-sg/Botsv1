# Architecture

This document explains how the Fleet Manager (the **Host**) is put together and why. The README
covers features and usage; this covers the internal structure.

## The shape of the system

The Host is a **control plane**, not a runner. It never launches Minecraft and never holds a game
account. Real Minecraft clients running the **Logvex Worker** mod dial *out* to it, register, and
then accept a closed set of tasks. That inversion is the whole point: a worker only needs an
outbound connection, so the Host never needs an inbound port on a bot machine.

```
┌──────────────────────────── Electron main (Node) ────────────────────────────┐
│  index.ts                                                                    │
│   ├─ AppContext ── db (SQLite) + repositories + EventBus + WorkerService      │
│   ├─ ApiServer  ── local HTTP + WebSocket (/events), token auth              │
│   ├─ IPC handlers ── renderer <-> context                                     │
│   └─ WorkerServer ── ws://<host>:8721/worker  (the inbound socket)            │
└──────────────────────────────────────────────────────────────────────────────┘
        ▲ ws:// (workers dial out)      ▲ IPC (preload)     ▲ fetch/WebSocket (API token)
        │                               │                   │
┌── Logvex Hunter mod (MC client) ─┐  ┌─ renderer (React) ─┐ └─ external tools / automation
│  reads the client, runs tasks    │  │  shell, pages,     │
│  reconnects forever              │  │  store, API bridge │
└──────────────────────────────────┘  └────────────────────┘
```

There is no child process per bot. A worker is an external client, so the Host's cost is one
WebSocket per worker and a small amount of in-memory state, not a Node process.

## Layering

| Layer | Responsibility | Electron-free? |
| --- | --- | --- |
| `shared/` | Domain types, the worker protocol mirror, the event catalog, the IPC contract | yes |
| `db/` | SQLite schema, migrations, typed repositories | yes |
| `services/events/` | The event bus (the one event stream) | yes |
| `workers/` | The worker WebSocket server and `WorkerService` (the control plane) | yes |
| `api/` | Local HTTP + WebSocket surface and its auth | yes |
| `ipc/` + `index.ts` | Electron glue | no |

`AppContext` (`context.ts`) constructs and wires everything. It is deliberately pure with respect to
Electron, which is what lets the integration tests build a complete, working context over an
in-memory database and drive a real WebSocket worker against it.

## Data flow

- **Worker → Host.** A worker sends `hello`, then `register` and periodic `status` snapshots,
  `inventory` reports, `result`s and `log` lines. `WorkerServer` authenticates the socket, hands the
  snapshot to `WorkerService`, and publishes an event on the bus.
- **Host → Worker.** The UI or the API calls `WorkerService.runTask(...)`, which asks `WorkerServer`
  to send a `task` frame and waits for the matching `result`. A timeout or a refusal **raises**, so
  the caller can never mistake "asked" for "done".
- **Events.** `WorkerService` and the Host publish to `EventBus`; the UI subscribes over IPC and the
  API over WebSocket, so both see the same stream. The UI never polls; it re-renders from pushed
  events.
- **Persistence** is SQLite through typed repositories. Migrations run at startup and are versioned.
  Live connection state stays in memory; the database holds the roster, groups, task history,
  command audit log, inventory cache and regear presets.

## The worker protocol

The wire contract lives in `shared/workers.ts` and mirrors
`src/main/java/com/logvex/worker/core/Protocol.java`. `tests/unit/worker-protocol-drift.test.ts`
reads the Java source and asserts the two agree, so a drift fails the build rather than reaching a
user as a frame neither side understands.

Two rules keep it safe:

- **A closed task set.** The Host may only send one of ten task kinds with a validated payload; the
  worker dispatches it through a fixed switch. There is no code, class name or shell command on the
  wire.
- **Version refusal, not coercion.** A version mismatch is refused on both sides. The inbound decoder
  (`decodeEnvelope`) drops anything that is not a well-formed object with a string type, and never
  throws on hostile input.

Mutating kinds (`regear`, `command`, `chat`, `efly`) are **exclusive per worker**: the server refuses
a second conflicting task while one is in flight, so a flight and a regear can never race.

## Pairing

There are two credentials, both generated on the Host:

- a long-lived **worker token** (the shared secret), and
- a short, single-use, expiring **pairing code**.

A worker's first `hello` may carry a pairing code instead of the token. `WorkerServer` validates it
through `verifyPairingCode`, answers with the shared token, and consumes the code. The worker stores
the token and uses it on every later reconnect. This is how a bot machine is enrolled without copying
the long token by hand.

## Security

- The worker token and pairing code are the only things that admit a socket; a wrong token or a stale
  code is refused with a reason the client logs.
- The renderer runs with `contextIsolation: true`, `nodeIntegration: false`; it can only reach main
  through the explicit preload API surface.
- The local API requires a bearer token (or `?token=`), generated on first run and rotatable in
  Settings. It binds to loopback by default; `/health` is the only open route.
- The Host never executes worker-supplied text: a command or chat line is forwarded as a task payload
  and the worker decides whether its own permissions allow it.

## Extending

- **New task kind**: add it to `TASK_KINDS` in `shared/workers.ts`, to the Java `Protocol`/`TaskCatalog`
  (the drift test will enforce agreement), to the worker's dispatcher, and to `KIND_PARAMS` in the
  Tasks page so the UI offers the right inputs.
- **New page**: add a component under `renderer/pages/`, register it in the `NAV`/`TITLES` maps in
  `App.tsx`, add the corresponding `FleetApi` methods in `shared/ipc.ts` and the preload bridge, and
  an IPC handler in `main/ipc/handlers.ts`.
- **New event**: add it to the catalog in `shared/events.ts` so the store and the API both know it.
