# Worker protocol

The contract between a **Logvex Worker** Minecraft client and the **Logvex Fleet Manager** host.

This is the outbound half of the Fleet Manager ecosystem: the worker dials the host, not the other
way round, and the host may only ask for things the worker already knows how to do. The other
direction — the host *reading* a client over HTTP — is the companion API and is documented in
[`../USAGE.md`](../USAGE.md) (§13).

## Where the contract lives

| Side | File | Role |
| --- | --- | --- |
| Worker (Java) | [`worker-mod/src/main/java/com/logvex/worker/core/Protocol.java`](../worker-mod/src/main/java/com/logvex/worker/core/Protocol.java) | The declared constants: version, message types, task kinds, payload field names, efly actions. |
| Host (TypeScript) | [`host/src/shared/workers.ts`](../host/src/shared/workers.ts) | The host mirror: the same constants plus the envelope decoder and the snapshot/task types. |
| Drift guard | [`host/tests/unit/protocol-consistency.test.ts`](../host/tests/unit/protocol-consistency.test.ts) | Runs `protocol/check-protocol.mjs`, the canonical checker that reads all three mirrors (`protocol.json`, `workers.ts`, `Protocol.java`) and asserts they agree. |

The two copies are kept in sync by hand, because one is Java and one is TypeScript. The drift test is
what makes that safe: it parses the Java constants and compares them to the TypeScript ones, so a
message type or task kind added to one side only fails `npm test` in CI instead of reaching a user as
a frame the other side cannot understand. `worker-mod`'s own `TaskCatalogTest` covers the worker's
copy in the same spirit.

If you change the protocol, change it in this order:

1. Edit `Protocol.java` (add the constant).
2. Mirror it in `src/shared/workers.ts` and, if it is a task kind, add it to `TASK_KINDS` and to
   `TaskCatalog.KINDS`.
3. Add the field to the relevant payload type and its decoder in `workers.ts`.
4. Run `npm test` in `fleet-manager` and `./gradlew :worker-mod:test` at the root — the drift test
   and the catalog test will tell you what you missed.
5. Bump `Protocol.VERSION` if the envelope or an existing payload changes *shape*, and note it in
   [`../CHANGELOG.md`](../CHANGELOG.md).

## Transport

- A **WebSocket** at path `/worker` on the host's worker server (default `127.0.0.1:8721`).
- Each frame is one JSON object on its own line — **newline-framed JSON**, not a WebSocket message
  per frame, so the same envelope is easy to log and test.
- The worker authenticates with the shared token from the host's **Settings → Worker server**, or —
  on its very first connection — with a short **pairing code** the host generates. A frame with the
  wrong token, a stale code, or a `v` that does not match `Protocol.VERSION`, is refused at the
  handshake.

### Envelope

```json
{ "v": 3, "type": "task", "id": "t-42", "payload": { "kind": "efly", "action": "start" } }
```

| Field | Type | Notes |
| --- | --- | --- |
| `v` | number | Protocol version. Missing is defaulted to the current version; a mismatch is refused. |
| `type` | string | One of the message types below. Anything else is dropped. |
| `id` | string \| null | Correlates a request with its `result`/`progress`/`error`. Absent on unsolicited frames. |
| `payload` | object | Type-specific. A non-object payload is replaced with `{}` rather than trusted. |

The host's decoder (`decodeEnvelope`) never throws: anything that is not a JSON object with a string
`type` is dropped. This is the host's only defence against a malformed frame from a remote client, so
it is tested directly.

## Pairing

A worker is enrolled without copying the long token by hand:

1. On the host, **Generate pairing code** produces a short code (e.g. `ABCD2345`) that is valid for a
   few minutes and can be used once.
2. The worker's first `hello` carries that code in `payload.pairingCode` instead of `payload.token`.
3. The host validates the code, replies `hello-ack` with `accepted: true` and the shared `token`, and
   consumes the code.
4. The worker stores the token in its config and presents it as `payload.token` from then on. The
   code is never needed again.

A code that is wrong, already used or expired is refused with `accepted: false` and a reason.

## Message types

| Direction | Types |
| --- | --- |
| worker → host | `hello`, `register`, `status`, `inventory`, `equipment`, `result`, `progress`, `pong`, `error`, `log` |
| host → worker | `hello-ack`, `command`, `task`, `ping`, `kick`, `control` |

- **`hello` / `hello-ack`** — version and credential check at connect. The `hello` payload carries
  `token` and/or `pairingCode`; when a valid one-time `pairingCode` is presented, the `hello-ack`
  carries the shared `token` and the code is consumed, so the worker can store the token and use it
  on every later reconnect.
- **`register`** — the worker announces its stable id, username and capabilities (the task kinds it
  supports). The host records the roster entry here.
- **`status`** — the heartbeat snapshot (world, dimension, coordinates, health, food, armour, totems,
  held/off-hand item, current task). Also carries `capabilities`.
- **`inventory` / `equipment`** — snapshots on request or on the worker's own schedule.
- **`task`** — host asks the worker to run one named kind. The worker answers `result` (and may emit
  `progress` first).
- **`command`** — a one-line command/chat send, kept separate from `task` for the audit log.
- **`ping` / `pong`** — liveness check.
- **`control`** — a host-driven service action: `connect`, `disconnect`, `restart`, `pause` or
  `resume`. `pause` blocks mutating tasks while read-only tasks keep running; `disconnect` marks the
  worker stopped (it stays reachable so `connect` can bring it back); `restart` re-applies the link
  settings. The worker stamps `paused` and `stopped` onto every snapshot it sends, so the host reads
  the real state rather than assuming the action took effect. The desktop app's **Worker Mode** page
  sends the same control messages, so a button there proves the host's command works.
- **`kick`** — the host asks the worker to disconnect and stop.
- **`log`** — the worker forwards its own link log (throttled to at most one line a second), which
  the host shows in the Fleet **Console** tab.
- **`error`** — a failed frame, with a reason.

## Task kinds

The worker executes only these. A `task` with any other `kind` is refused with an `error`, and the
host UI offers only these.

| Kind | Mutating | What it does |
| --- | --- | --- |
| `status` | no | Report the status snapshot. |
| `inventory` | no | Report the carried inventory, open-container contents and worn armour. |
| `count` | no | Count an item (`query`). |
| `search` | no | Find an item (`query`). |
| `equipment` | no | Report equipment requirements. |
| `position` | no | Report coordinates. |
| `regear` | **yes** | Compare against a loadout; move matching items out of an *already-open* container only when `allowMoves` is set, then re-read inventory. |
| `command` | **yes** | Send a server command, only if it is on the worker's allow-list. |
| `chat` | **yes** | Send a chat line (length-limited). |
| `efly` | **yes** | Engage/stop the client's own elytra flight (see below). |

**Mutating kinds are exclusive per worker.** The host refuses to start a second mutating kind
(`regear`, `command`, `chat`, `efly`) on a worker that already has one in flight, so a flight and a
regear can never race. This list mirrors the worker's `TaskCatalog.isMutating`.

## EFly payload

`efly` is the one task that moves the client. Its payload is a small set of plain fields, validated
in `EflyRequest` before it can reach the game, and mapped onto Meteor's own `ElytraFly` and
`PathManagers`.

| Field | Meaning |
| --- | --- |
| `action` | `start` or `stop` (also accepts `on`/`off`). |
| `x`, `y`, `z` | Target coordinates. A target is used only when all three are present; otherwise the action engages flight in place. |
| `mode` | Optional `ElytraFly` mode name (`vanilla`, `packet`, `pitch40`, `bounce`). Blank keeps the current mode. |
| `minHeight` | Optional minimum cruise height (default 120). |
| `useFireworks` | Optional; use fireworks to sustain flight. |
| `startPathing` | Optional; defaults to true when a target is present. |

A malformed payload (unknown action, a partial or non-finite target) is refused before it reaches the
client, and the worker answers with a failed result rather than guessing.

## Security boundary

The protocol is a **closed set**. The host never sends code, a class name or a shell command; it
sends one of the message types above with a validated payload, and the worker dispatches it through a
fixed switch. That is what keeps a compromised or buggy host from turning a worker into remote code
execution. On top of that:

- Commands are checked against the worker's own allow-list (`CommandValidator`); everything else is
  rejected with a reason.
- The worker never fights, aims or attacks — there is no combat task kind.
- The worker never opens a container on its own; `regear` with moves only touches a screen that is
  already open.
