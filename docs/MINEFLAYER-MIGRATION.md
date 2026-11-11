# Mineflayer-first migration

This document is the plan the code in `bot/` implements. It records what moved, what stayed, why,
and how the two halves stay compatible. Read it before changing either side.

## 1. Why the worker layer, and not the addon

The repository has three separate control planes. Only one of them is the right home for
autonomous botting:

| Plane | Transport | What it does | Verdict |
| --- | --- | --- | --- |
| **Worker protocol** (`host/src/main/workers`, `src/main/java/com/logvex/worker/`) | WebSocket, JSON, `/worker` | A client dials *out* to the host; the host sends one of a closed set of task kinds; the client reports a result. | **Migrate to Mineflayer.** The protocol is already transport-agnostic and bot-shaped. |
| **Swarm** (`src/main/java/com/logvex/hunter/core/swarm`) | Raw TCP, newline JSON | One Meteor client drives other Meteor clients for combat. | **Stays Fabric.** It exists to coordinate in-game combat modules that only make sense inside a client. |
| **Companion** (`core/companion`) | HTTP + SSE, `/api/v1/*` | A browser or script reads one Hunter client's state and sends control lines. | **Stays Fabric.** It is a window into a live human client, not a bot runner. |

The Hunter addon is a *combat and awareness* tool for a player who is present. It targets players,
prints chat messages, tracks statistics and coordinates Meteor's KillAura/AutoTotem. None of that is
what an autonomous worker does, and none of it is achievable — or desirable — from a headless
protocol client. Forcing it onto Mineflayer would mean rewriting a working in-game feature set to do
something worse.

So the split is:

- **Mineflayer (`bot/`)** owns everything a *worker* does: connecting to a server, holding an
  inventory, opening containers, moving items, packing and unpacking shulkers, walking to a chest,
  scanning portals, reporting status, and running a natural-language task. This is the autonomous
  execution framework.
- **Fabric (Hunter + Worker, one mod)** keeps what genuinely needs the game client: the Meteor module
  UI, the combat coordination layer, the swarm, the HUD, and the companion API. The Worker half keeps
  working exactly as before and remains a first-class worker runtime.

Both runtimes speak **the same worker protocol** to the same host. The host does not care which one
is on the other end.

## 2. What is shared, and how

`bot/` is a standalone npm package. It is also a dependency of the host:

```json
"@logvex/bot": "file:../bot"
```

The host imports **only the `./ai` subpath** (the provider abstraction and the natural-language
planner). That subpath has no Mineflayer import, so requiring it never drags the Minecraft protocol
stack into the Electron main process. Everything else the host needs from a bot it already gets over
the worker protocol.

This is deliberate: one implementation of the AI layer and one implementation of the classification
and planning engines, used by both the headless bot and the dashboard.

## 3. Protocol version 4

The wire contract is declared three times and checked by `protocol/check-protocol.mjs`. Version 4
is **additive**:

- `hello` and `register`/`status` snapshots gain `runtime` (`"mineflayer"` or `"fabric"`). A v3
  peer that omits it is treated as `fabric`.
- One new task kind, `nl-task`, carrying `{ instruction }`. A runtime that does not implement it
  refuses it like any other unsupported kind.
- One new outbound frame, `config`, carrying a runtime configuration patch (server, account label,
  permissions, plugin toggles). A runtime that does not implement it ignores it.

Additive changes were chosen over a breaking bump because a v3 worker and a v4 host must keep
working together during the migration — that is the whole point of a migration rather than a
rewrite. `negotiate()` accepts a peer whose version is within one of the host's.

## 4. Security boundary

The security model is unchanged and is the reason the protocol is a closed task set rather than an
RPC surface:

- The host sends a `kind` plus validated primitives. It never sends code.
- The worker validates every field (`StorageRequests` on the Java side, `core/storage-requests.ts`
  on the bot side) and clamps limits.
- Mutating kinds are gated by per-kind permission flags in the worker's own config, which the host
  cannot widen over the wire.
- Commands are checked against a verb allowlist.
- The bot never bypasses server protections: it only interacts with blocks through normal gameplay
  actions, only breaks the blocks it placed or the portals it was explicitly told to remove, and
  refuses to touch a protected structure.

## 5. Phases

Each phase is independently testable and leaves the tree green.

| Phase | Deliverable |
| --- | --- |
| 1 | `bot/` package: config, logging, identity, permissions, error taxonomy, event bus. |
| 2 | Pure engines: item classification, inventory math, storage networks, shulkers, navigation planning, portal/structure registry, verification. |
| 3 | Reliability: persistent task queue, operation locks, rate limits, safe retry with uncertainty handling. |
| 4 | Plugin system with explicit interfaces and declared dependencies; the eleven plugins. |
| 5 | Mineflayer adapters: connection, inventory, containers (with read-back verification), shulkers, pathfinding navigation, portals, status. |
| 6 | Runtime: link, heartbeat, recovery, reconnect, graceful shutdown, task dispatch. |
| 7 | AI: provider abstraction (Ollama, plus a deterministic offline provider), natural-language interpreter, validation, approval gate. |
| 8 | Host integration: protocol v4, runtime badge, AI provider settings, natural-language task box. |
| 9 | Tests: unit for every engine, integration against a real in-process Minecraft server. |
| 10 | Docs, changelog, release. |

## 6. Testing strategy

Pure engines are unit-tested. The adapters are tested against a **real Minecraft server running
in-process** (`flying-squid`), with a **real Mineflayer client** connecting to it. Nothing about the
inventory, container or movement paths is mocked — the tests assert on what the bot actually
observed, which is the only way to know the integration is real.
