# Logvex Multiverse — Architecture

This document is the specification the code is built against. It records the product, the
component boundaries, the technology decisions and the staged implementation plan. When the code
and this document disagree, one of them is a bug.

---

## 1. What the product is

Logvex Multiverse is a central control system for **real Minecraft clients**. It does not simulate
bots: every worker is an actual Minecraft: Java Edition client with the Logvex Worker mod installed,
which dials *out* to the Host. Nothing the Host shows about a worker is invented — it is what that
client last reported.

Four components:

| Component | Lives in | Responsibility |
|-----------|----------|----------------|
| **Host** | `host/` (Electron + React + TypeScript) | Registry, servers, groups, tasks, scheduling, inventory, equipment, analytics, permissions, persistence, UI |
| **Worker** | `worker-mod/` (Fabric mod, Java 21) | The Minecraft-side executor: connects out, registers, reports, runs a closed set of client-side tasks |
| **Meteor integration** | `worker-mod/src/main/java/com/logvex/worker/meteor/` | Exposes the worker inside Meteor's ClickGUI under a `Logvex Multiverse` category |
| **Multiverse** | Host-side organisational layer | Server profiles, worker groups, task environments, equipment presets, per-version compatibility |

### Direction of control

```
   Host (control plane)                     Worker (a real Minecraft client)
   ─────────────────────                    ────────────────────────────────
   listens on ws://host:port/worker  ◄────  dials out, presents token/pairing code
   sends task / control / ping       ────►  executes, reports result / progress / status
```

The Host never opens an inbound port on a bot machine, so it works from behind NAT. The Host never
launches Minecraft and holds no game account.

---

## 2. Repository layout

The repository keeps the two build halves independent, which the specification requires:

```text
Botsv1/
├── host/                      Electron desktop Host (npm project, builds on its own)
│   ├── src/main/              Electron main process (Node): DB, services, sockets, IPC, HTTP API
│   │   ├── db/                SQLite wrapper, migrations, repositories
│   │   ├── workers/           Worker server (sockets) + worker service (the one API)
│   │   ├── worker-mode/       This machine acting as a *worker* (outbound client)
│   │   ├── services/          Event bus and other cross-cutting services
│   │   ├── packages/          Pure, Minecraft-free, unit-tested engines (see §3)
│   │   └── api/ ipc/          HTTP API + IPC surface
│   ├── src/renderer/          React UI (Vite)
│   ├── src/shared/            Types + protocol mirror shared by main and renderer
│   └── tests/                 Vitest: unit + integration (real sockets)
├── worker-mod/                Fabric worker mod (Gradle subproject, builds on its own)
│   └── src/main/java/com/logvex/worker/
│       ├── core/              Minecraft-free: protocol, config, link, task catalog
│       ├── mc/                Game adapters (client-thread only)
│       └── meteor/            Meteor category + modules
├── protocol/                  Canonical wire contract + drift checker
│   ├── protocol.json          Single source of truth
│   └── check-protocol.mjs     Asserts protocol.json == workers.ts == Protocol.java
├── docs/                      PROTOCOL.md, ARCHITECTURE.md, guides
└── src/                       LogVex Hunter addon (a *separate* product, unchanged)
```

### Why the layout differs from the sketch in the brief

The brief proposed an `apps/` + `packages/` monorepo. That was deliberately **not** adopted
verbatim, for one reason: the Host is an Electron/TypeScript project and the Worker is a
Gradle/Fabric project, and they already build and release independently, which is the requirement
that actually matters. Wrapping them in a JS-workspace monorepo would add a build layer that buys
nothing and risks the two working builds.

The *modularity* the brief is really asking for is delivered where it matters: inside the Host, as
a set of small, single-purpose, Minecraft-free, unit-tested packages (§3), and inside the Worker as
`core` (pure) versus `mc` (game adapters). The `protocol/` directory is the shared, canonical
package both halves are checked against.

---

## 3. Host internal packages

These live under `host/src/main/packages/`. Each is pure TypeScript with no Electron, no SQLite and
no sockets, so each is unit-testable on its own. Services wire them together.

| Package | Responsibility |
|---------|----------------|
| `protocol` | Envelope encode/decode, validation, version negotiation |
| `lifecycle` | The worker state machine (valid transitions, derived flags) |
| `capabilities` | Capability schema, versioning, "can this worker run this task?" |
| `task-engine` | Task definitions, lifecycle, validation, results |
| `scheduler` | Cron/interval/one-shot scheduling with missed-run handling |
| `inventory-engine` | Counting, snapshot diffing, aggregation, history |
| `equipment-engine` | Loadout comparison, missing-gear detection, regear planning |
| `group-engine` | Groups, tags, templates, bulk-operation result aggregation |
| `telemetry` | Metrics with defined sources (uptime, completion rate, durations) |
| `shared-types` | Domain types shared across packages |

Rule: a package may depend only on `shared-types` and other packages, never on a service, the DB or
Electron. This is what makes the engines testable and keeps the tick path allocation-free.

---

## 4. Technology decisions (audit outcome)

Kept because they already fit and work:

- **Electron + React + TypeScript + Vite** for the Host. The brief asks for a desktop application;
  this is one, and it builds and packages today.
- **SQLite (`better-sqlite3`)** for persistence. Synchronous, in-process, transactional, no server.
- **`ws`** for the worker WebSocket. The Host needs a server; the Worker mod uses its own client.
- **Fabric + Meteor** for the Worker mod, compiled to Java 21 bytecode (Minecraft 1.21.11 runs on
  Java 21). The build runs on JDK 25 because Fabric Loom 1.18 requires a Java 25 runtime.

Rejected / not introduced:

- No message broker, no separate microservices, no container orchestration. The whole system runs on
  one machine, which the brief asks for.
- No `mineflayer` or headless bot library. Workers are real clients; simulating them was the earlier
  architecture and was removed.
- No new UI framework. React is already here and working.

Removed in earlier rewrites (kept removed): the mineflayer-era account/deployment/instance/role
tables and the credential vault.

---

## 5. Worker identity, lifecycle and capabilities

**Identity** (durable, survives reconnects): unique `id`, Minecraft `username`, operator-set
`label`, `minecraftVersion`, Fabric Loader version, worker mod version, Meteor version, assigned
`serverProfileId`, assigned `groupId`, `tags[]`, `firstSeen`, `lastSeen`, `lastAddress`, notes.

**Lifecycle** — the Host distinguishes these states and validates transitions between them:

```
UNREGISTERED ─► PAIRING ─► CONNECTING ─► ONLINE ⇄ BUSY
                                  │        │  ⇅
                                  │      IDLE / PAUSED
                                  ▼
                            RECONNECTING ─► DISCONNECTED
                                  │
                                  ▼
                             ERROR / INCOMPATIBLE
```

`UNRESPONSIVE` is derived: a worker that is `ONLINE` but whose heartbeat is overdue. This is
deliberately distinct from `DISCONNECTED` — the socket is still open.

**Capabilities** — the worker reports a versioned capability object; the Host refuses to offer a task
whose required capability the worker does not advertise. Capabilities are versioned so a newer
worker can advertise more without the Host guessing.

---

## 6. Task model

A task is a structured unit of client-side functionality with: id, name, description, category,
version, required capabilities, required permissions, config schema, and start/stop/pause/resume
handlers plus progress/result reporting. Task states:

`DRAFT → QUEUED → VALIDATING → RUNNING ⇄ PAUSED → COMPLETED | FAILED | CANCELLED`

Mutating kinds (`regear`, `command`, `chat`, `efly`) run one at a time per worker; the worker
refuses a conflicting second one. Every result is the worker's actual report — an operation that
could not complete is reported as failed, never as completed.

---

## 7. Security model

- **Outbound only.** The Host never sends code, a class name or a shell command. It sends one of a
  closed set of message types with a validated payload, which the worker dispatches through a fixed
  switch. There is no remote code execution surface.
- **Authenticated.** A worker presents the shared token, or a single-use time-limited pairing code
  on its first join; the Host answers with the shared token.
- **Versioned.** A protocol-version mismatch is refused, not coerced.
- **Permissioned.** Owner / Administrator / Operator / Viewer levels gate what the Host will do.
- **Audited.** Every command, task and control action is recorded.

---

## 8. Staged implementation plan

Each stage ends with a build, a test run, fixed errors, updated docs and a commit. A stage is not
"done" until its tests pass.

| Stage | Content |
|-------|---------|
| 1 | Product + repository audit; this specification |
| 2 | Shared protocol: identity, capabilities, lifecycle, versioning, drift check |
| 3 | Host foundation: shell, database, settings, worker registry |
| 4 | Worker foundation: pairing, registration, capabilities, status reporting |
| 5 | Remote control: individual controls + acknowledgements |
| 6 | Group engine: groups, tags, templates, bulk ops, failure isolation |
| 7 | Server manager: multi-server profiles + worker assignments |
| 8 | Inventory engine: reporting, counting, history, analytics |
| 9 | Equipment engine: inspection, presets, regear |
| 10 | Task engine: definitions, lifecycle, scheduling, presets, sequences |
| 11 | Movement + EFly |
| 12 | Meteor integration: `Logvex Multiverse` category + synchronisation |
| 13 | Analytics + automation rules |
| 14 | Complete UI: navigation, dashboard widgets, command centre, worker detail |
| 15 | Integration testing with multiple clients |
| 16 | Release engineering: independent Host and Worker releases |

Progress against this plan is recorded in `CHANGELOG.md` and the project memory.
