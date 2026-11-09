# Logvex Worker

A small Fabric companion mod for Minecraft 1.21.11 that connects a client to the **Logvex Fleet
Manager** desktop app over a WebSocket and answers a closed set of named tasks.

It is the outbound half of the Fleet Manager's worker feature. The Fleet Manager asks; the worker
answers with what it actually observed. It never fights and never runs code the host invents.

## What it does

- Connects to the Fleet Manager's worker server and authenticates with a shared token.
- Reports a **status** snapshot on a heartbeat: world, dimension, coordinates, health, food, armour
  pieces, totems, food items, held/off-hand item, current task.
- Reports an **inventory** snapshot on request: carried stacks, the contents of a container screen
  that is *already open*, and worn armour with per-piece durability.
- Answers read-only queries: **count** and **search** for an item, and **equipment** requirements.
- Runs a **regear** comparison against a loadout the host sends, and (only when the host explicitly
  allows moves) shift-clicks matching items out of an already-open container, then re-reads its
  inventory so the report is what really happened.
- Sends a server **command** or a **chat** line, but only if it is on the allow-list (see below).

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
`fleet-manager/src/shared/workers.ts`. Integration tests on the host side drive a real
worker-shaped client, so a drift between the two fails the build.

| Direction | Types |
| --- | --- |
| worker → host | `hello`, `register`, `status`, `inventory`, `equipment`, `result`, `progress`, `pong`, `error`, `log` |
| host → worker | `hello-ack`, `command`, `task`, `ping`, `kick` |
| task kinds | `status`, `inventory`, `count`, `search`, `equipment`, `regear`, `command`, `chat`, `position` |

## Command allow-list

Commands are validated before they reach the server. `CommandValidator` accepts only the commands
on the list (a small set of non-destructive informational and navigation commands) and rejects
everything else with a reason. Chat lines are length-limited. This is deliberate: the host is a
remote party, so the worker must decide for itself what it is willing to do.

## Installation

1. Install Fabric Loader for Minecraft 1.21.11.
2. Put `logvex-worker-1.0.0.jar` (from `worker-mod/build/libs`) into the client's `mods` folder.
3. Start the client once; a config file is written to `config/logvex-worker.json`.
4. In the Fleet Manager, open **Settings → Worker server**, copy the shared token and note the port.
5. In the client's config, set the host and token:

```json
{
  "host": "127.0.0.1",
  "port": 8721,
  "token": "<the token from Settings>",
  "workerId": "",
  "label": ""
}
```

`workerId` is assigned by the host on first connect and remembered; leave it blank to let the host
pick one. `label` is a friendly name you can also set from the Fleet Manager's Workers tab.

## Building

The worker mod is a subproject of the repository root build, so build it from the repository root:

```bash
export JAVA_HOME=/workspace/tools/jdk-25.0.5+8   # JDK 25 is required by Fabric Loom
./gradlew :worker-mod:clean :worker-mod:test :worker-mod:build
```

The jar lands in `worker-mod/build/libs/logvex-worker-1.0.0.jar`.

## Tests

```bash
./gradlew :worker-mod:test
```

The tests cover the parts that are Minecraft-free and therefore fully testable off a client:
`Envelope` parsing, `CommandValidator`, `ItemQuery` matching, `InventorySummary` aggregation,
`EquipmentReport` evaluation, and `WorkerLink` against a real loopback WebSocket server
(handshake, task round-trip, retry-from-cache, and refusal on a bad token or version).
