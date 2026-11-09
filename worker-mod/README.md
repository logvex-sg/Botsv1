# Logvex Worker

A small Fabric companion mod for Minecraft 1.21.11 that connects a client to the **Logvex Fleet
Manager** desktop app over a WebSocket and answers a closed set of named tasks.

It is the outbound half of the Fleet Manager's worker feature. The Fleet Manager asks; the worker
answers with what it actually observed. It never fights and never runs code the host invents.

## What it does

- Connects to the Fleet Manager's worker server and authenticates with a shared token, or with a
  short one-time **pairing code** on its first connection (the host then hands back the token, which
  the worker stores and reuses).
- Reports a **status** snapshot on a heartbeat: world, dimension, coordinates, health, food, armour
  pieces, totems, food items, held/off-hand item, current task.
- Reports an **inventory** snapshot on request: carried stacks, the contents of a container screen
  that is *already open*, and worn armour with per-piece durability.
- Answers read-only queries: **count** and **search** for an item, and **equipment** requirements.
- Runs a **regear** comparison against a loadout the host sends, and (only when the host explicitly
  allows moves) shift-clicks matching items out of an already-open container, then re-reads its
  inventory so the report is what really happened.
- Sends a server **command** or a **chat** line, but only if it is on the allow-list (see below).
- Flies itself with its own elytra on request: an **efly** task engages or stops Meteor's own
  `ElytraFly`, and can path to a target with Meteor's `PathManagers`. It uses the client's own
  movement, never a private flight implementation.
- Forwards its own link log to the host as throttled `log` frames, so the Fleet Manager's Console
  tab shows what the client itself saw (connect, register, task outcomes, errors).

## What it never does

- It does not fight, aim, or attack. There is no combat task kind.
- It never opens a container on its own; `regear` with moves only touches a screen that is already
  open.
- It never executes a shell command, a class name, or code of any kind. The host sends one of the
  message types in `Protocol.java` with a validated payload, and the worker dispatches it through a
  fixed switch. That is what keeps the protocol from becoming remote code execution.

## Protocol

The envelope is newline-framed JSON: `{ v, type, id, payload }`. `v` is the protocol version
(`Protocol.VERSION`); a mismatch is refused at the handshake. The message types and task kinds are
declared once in `com.logvex.worker.core.Protocol` and mirrored by the host in
`host/src/shared/workers.ts`, with a third canonical copy in `protocol/protocol.json`. The checker
`protocol/check-protocol.mjs` reads all three and asserts they agree, so a type added to one side
only fails the build. The full
contract is written down in [`../docs/PROTOCOL.md`](../docs/PROTOCOL.md).

| Direction | Types |
| --- | --- |
| worker → host | `hello`, `register`, `status`, `inventory`, `equipment`, `result`, `progress`, `pong`, `error`, `log` |
| host → worker | `hello-ack`, `command`, `task`, `ping`, `kick`, `control` |
| task kinds | `status`, `inventory`, `count`, `search`, `equipment`, `regear`, `command`, `chat`, `position`, `efly` |

Mutating kinds (`regear`, `command`, `chat`, `efly`) are exclusive: the host refuses to start a
second one on a worker that already has one in flight, so a regear and a flight can never race.

## EFly task

`efly` is the one task that moves the client. Its payload is a small set of plain fields; the game
layer maps them onto Meteor's `ElytraFly` and `PathManagers`, so the worker only ever steers with
the client's own modules.

| Field | Meaning |
| --- | --- |
| `action` | `start` or `stop` (also accepts `on`/`off`). |
| `x`, `y`, `z` | Target coordinates. A target is only used when all three are present; otherwise the action just engages flight in place. |
| `mode` | Optional `ElytraFly` mode name (`vanilla`, `packet`, `pitch40`, `bounce`). Blank keeps the current mode. |
| `minHeight` | Optional minimum cruise height (default 120). |
| `useFireworks` | Optional; use fireworks to sustain flight. |
| `startPathing` | Optional; defaults to true when a target is present, so the client flies to it. |

A malformed payload (unknown action, a partial or non-finite target) is refused in `EflyRequest`
before it reaches the client, and the worker answers with a failed result rather than guessing.

## Command allow-list

Commands are validated before they reach the server. `CommandValidator` accepts only the commands
on the list (a small set of non-destructive informational and navigation commands) and rejects
everything else with a reason. Chat lines are length-limited. This is deliberate: the host is a
remote party, so the worker must decide for itself what it is willing to do.

## Installation

1. Install Fabric Loader for Minecraft 1.21.11.
2. Put `logvex-worker-1.2.0.jar` (from `worker-mod/build/libs`) into the client's `mods` folder.
3. Start the client once; a config file is written to `config/logvex-worker.json`.
4. In the Fleet Manager, open the Dashboard and press **Generate pairing code** (or **Settings →
   Worker server** for the shared token and the port).
5. In the client's config, set the host and the pairing code:

```json
{
  "host": "127.0.0.1",
  "port": 8721,
  "pairingCode": "ABCD2345",
  "workerId": "",
  "label": ""
}
```

The worker connects, presents the code once, and the host answers with the shared token. The worker
writes that token back into `config/logvex-worker.json` and uses it from then on, so the code is
never needed again. If you would rather skip pairing, put the long-lived token in `token` directly
instead of `pairingCode`.

`workerId` is assigned by the host on first connect and remembered; leave it blank to let the host
pick one. `label` is a friendly name you can also set from the Fleet Manager's Workers tab.

## Building

The worker mod is a subproject of the repository root build, so build it from the repository root:

```bash
export JAVA_HOME=/path/to/jdk-25   # JDK 25 is required by Fabric Loom
./gradlew :worker-mod:clean :worker-mod:test :worker-mod:build
```

The jar lands in `worker-mod/build/libs/logvex-worker-1.2.0.jar`.

## Tests

```bash
./gradlew :worker-mod:test
```

The tests cover the parts that are Minecraft-free and therefore fully testable off a client:
`Envelope` parsing, `CommandValidator`, `ItemQuery` matching, `InventorySummary` aggregation,
`EquipmentReport` evaluation, and `WorkerLink` against a real loopback WebSocket server
(handshake, task round-trip, retry-from-cache, and refusal on a bad token or version).
