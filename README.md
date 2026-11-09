# Logvex Fleet Manager ecosystem

Two cooperating products live in this repository:

| Product | What it is | Where |
| --- | --- | --- |
| **LogVex Hunter** | A Meteor Client addon for Minecraft 1.21.11 (Fabric). Target tracking, combat coordination, equipment and stasis monitoring, statistics, an in-game **Host/Hunter swarm**, and a local companion API. | repository root (`src/main/java/com/logvex/hunter`) |
| **Logvex Worker** | A companion Fabric mod for Minecraft 1.21.11 that dials *out* to the Fleet Manager host and answers a closed set of tasks (status, inventory, count, regear, command, chat, efly). | `worker-mod/` |
| **Logvex Fleet Manager** | An Electron + React + TypeScript desktop **host**: it does not run bots, it controls real Minecraft clients that run the **Logvex Worker** mod and dial in over a WebSocket. | `fleet-manager/` |

**Two ways to control several clients.** The desktop **Fleet Manager** is a *host*: each
**Logvex Worker** client dials out to it, and the host sends tasks and reads confirmed results — see
[Logvex Worker](#logvex-worker-mod) and the Fleet Manager README. The **in-game swarm** does the same
thing without any external process: each client runs **LogVex Hunter**, and the `swarm` module puts
it in one of two modes — **Host** (drives the fleet) or **Hunter** (fully controlled by the host) —
see [In-game swarm](#in-game-swarm-control-many-clients-from-one). The companion API is a third,
*inbound* path that exposes a Hunter client's state and commands to a browser or automation — see
[Companion API](#companion-api-the-hunter--fleet-manager-bridge).

> **Scope note.** The Hunter addon is a *monitoring and coordination* tool. It observes players,
> records statistics, and coordinates Meteor's own combat modules around a manually or
> automatically selected target. It does not add unattended combat automation of its own. The
> Fleet Manager drives bot connections for controlled environments and degrades gracefully when a
> client is unreachable.

---

## LogVex Hunter (Meteor addon)

### Features

- **Hunter Dashboard** — a Meteor ClickGUI tab showing live state, the current target, session
  information, module toggles and recent combat events, with start/stop/emergency controls.
- **Player Tracking / Target Manager** — priority, bot, opponent, temporary, friend and ignore
  lists; configurable filters (friends, ignore list, naked players, invisible, creative, weapon
  requirement); last-known-position tracking; distance and target history; configurable sort
  order; automatic and manual target selection with a switch cooldown.
- **Combat Integration** — coordinates (never duplicates) Meteor's `KillAura`, `AutoWeapon`,
  `AutoTotem`, `AutoArmor` and `AutoEat`, and can disable `CrystalAura`/`AnchorAura` to avoid
  conflicts. Friend and ignore-list protection lives in the target lists.
- **Equipment Manager** — armour and durability monitoring, totem/food inventory checks,
  configurable thresholds and warning cooldowns, inventory status dashboard.
- **Configurable Chat Messages** — message profiles with per-template enable/cooldown, random
  selection, previews, and placeholders (`{player}`, `{username}`, `{health}`, `{weapon}`,
  `{server}`, `{coordinates}`, `{time}`, and more). Messages are local by default; sending to the
  server is opt-in.
- **Multi-Instance Management** — register other clients, poll their read-only statistics over an
  authenticated HTTP endpoint, and send a per-instance emergency stop. Each instance is isolated;
  no client's world state is assumed to be visible to another.
- **In-game Swarm** — control other LogVex Hunter clients from one host, in the game, in the spirit
  of Meteor's own Swarm. This is the **only mod** involved: each client runs LogVex Hunter and picks
  a mode. One client is the **host**; the rest run in **hunter** mode and are fully controlled by it.
  The host sees a live roster and can run any hunter command on one hunter or broadcast a read-only
  command to all of them. Every hunter command goes through the same control layer the local player
  uses, so the host can drive each hunter's target list, modules, settings, profiles and HUD. A
  broadcast that would arm combat on the whole fleet is refused unless you opt in. `.swarm …` in
  chat, or the Swarm screen from the dashboard.
- **Defensive Stasis System** — readiness levels (SAFE/CAUTION/DANGER/CRITICAL) from health,
  totems, food, armour and durability, with connection-loss detection and a recovery dashboard.
  Observation only: it never attacks.
- **Statistics** — kills, deaths, sessions, duration, encounters, equipment usage, module
  activations, K/D, recent events; JSON/CSV export.
- **Companion API** — a loopback HTTP endpoint (see below) that exposes read-only state and the
  same administrative commands as the in-game commands.

### Requirements

- Minecraft 1.21.11 with Fabric Loader 0.20.1
- [Meteor Client](https://meteorclient.com/) 1.21.11-SNAPSHOT
- Java 21 runtime (the mod targets Java 21, so it loads on a stock 1.21.11 install)
- **JDK 25** to build the addon — Fabric Loom 1.18 requires a Java 25 runtime (the mod itself is compiled to Java 21 bytecode)

### Installation

1. Install Fabric Loader for Minecraft 1.21.11.
2. Put Meteor Client in your `mods` folder.
3. Build the addon (see below) and copy `build/libs/logvex-hunter-1.2.0.jar` into `mods`.
4. Launch the game. The addon registers a **Logvex Hunter** category and ClickGUI tab.

### Building

```bash
# The build must run on JDK 25 (Fabric Loom 1.18 requires a Java 25 runtime).
# The mod itself is compiled to Java 21 bytecode and runs on Java 21.
export JAVA_HOME=/path/to/jdk-25
./gradlew clean test build
```

The remapped, release-ready jar is written to `build/libs/logvex-hunter-1.2.0.jar`.

### Commands

See [`USAGE.md`](USAGE.md) for the full use guide. The command reference:

```
.hunter                       # status summary
.hunter status
.hunter start | stop | pause | resume
.hunter emergency-stop | clear-stop
.hunter gui                   # open the dashboard
.hunter control               # open the Control screen (settings, profiles, HUD)
.hunter modules               # list module states
.hunter toggle <module>
.hunter get [module]          # every setting of one module, or all modules
.hunter set <module> <setting> <value>
.hunter profile               # list profiles
.hunter profile use <name> | create <name> | delete <name> | save
.hunter hud [list|<element>]  # list HUD elements, or toggle one
.hunter export | reload
.hunter companion [status|start|stop|token|regenerate|port <n>]
.hunter save

.swarm                        # swarm status (mode, port, hunters)
.swarm status                 # same as above
.swarm host                   # this client becomes the swarm host
.swarm join <ip> <port>       # this client becomes a hunter of that host
.swarm stop                   # stop the swarm link
.swarm connections            # list connected hunters
.swarm send <hunter> <command>  # run a hunter command on one hunter
.swarm broadcast <command>    # run a read-only command on every hunter
.swarm kick <hunter>          # disconnect a hunter
.swarm token <token>          # set the shared swarm token
.swarm port <port>            # set the swarm port
.swarm gui                    # open the Swarm screen

.target list [category]
.target add <player> [category]
.target remove <player>
.target focus <player>
.target clear
.target current
.target note <player> <text>
.target priority <player> <1-10>
.target category <player> <category>
.target gui

.hstats [show|sessions|events|export|reset|gui]
```

### In-game swarm (control many clients from one)

The swarm is Meteor-Swarm-style control that lives entirely inside the game: **one mod**, no
external app, no browser, no server, no second process. Every client runs LogVex Hunter; the swarm
module puts each one in one of **two modes**:

- **Host** — drives the fleet. It listens on a port, keeps a live roster of connected hunters, and
  sends them commands.
- **Hunter** — fully controlled by the host. It connects to the host and executes whatever the host
  sends, replying with the command's output.

1. On the machine you want to drive from, open the **Swarm** screen (dashboard → **Swarm**, or
   `.swarm gui`) and press **Become host**. Or run `.swarm host`.
2. On each other client, run `.swarm join <host-ip> <port>` (default port `6969`). Or open the Swarm
   screen and press **Become hunter**, then set the host and port in the module settings.
3. On the host, `.swarm connections` lists who is online. From the Swarm screen you can broadcast a
   command to all hunters or kick one.

Once connected, the host can run **any** hunter command on a hunter:

```
.swarm send <hunter> target add Griefer01
.swarm send <hunter> module player-tracker on
.swarm send <hunter> set equipment-manager min-durability 20
.swarm broadcast status
```

`send` accepts an id, a label, or a 1-based index (`1`, `2`, …). A hunter replies with the command's
output, which the host shows in chat and on the roster row.

**Safety.** A broadcast reaches every client at once, so only read-only, cosmetic and non-combat
tuning commands are allowed to broadcast (`status`, `save`, `hud`, `profile`, `target`, `settings`,
`notify`, and `set` of a setting that does not belong to a combat module). Lifecycle changes
(`start`, `stop`, …) and anything that would arm combat on the whole fleet are refused unless you
tick **allow-combat-broadcast** on the host; a single-hunter `send` that arms combat only warns.
`emergency-stop` is always allowed, and the host sends it to the fleet on its own emergency stop
before the link is torn down. The token is a shared secret: set the same value on the host and every
hunter, and leave `allow-remote` off unless the hunters are on other machines.

The protocol is newline-delimited JSON over TCP and is documented in
`core/swarm/SwarmProtocol.java`, so a non-Meteor client can be written against it.

### Configuration

Everything is stored as JSON under `.minecraft/config/logvex-hunter/`:

| File | Contents |
| --- | --- |
| `config.json` | master switch, emergency stop, active profile, instance identity, companion settings, profiles |
| `targets.json` | the target lists |
| `messages.json` | message profiles and templates |
| `statistics.json` | counters, sessions and recent events |
| `instances.json` | the registered instances |

A corrupt file is moved to `backups/` and reset to defaults instead of crashing; the reason is
reported in chat on the next launch.

Ready-to-use example files for all four are in [`examples/`](examples/) — copy one over the
matching file under `config/logvex-hunter/` to start from it.

---

## Companion API (the Hunter ↔ Fleet Manager bridge)

When the **companion** module is enabled (`.hunter companion start`), the addon runs a small HTTP
endpoint — on loopback by default — so the Fleet Manager or the bundled web page can read state and
send commands. A bearer token is required; if none is set, one is generated on first start and
printed in chat. The endpoint only serves requests while the hunter is running.

Endpoints (all under the configured port, default `8720`):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | version, connection and running state (public) |
| GET | `/api/v1/snapshot` | bot view, players, targets, modules and stats in one call |
| GET | `/api/v1/players` | visible players |
| GET | `/api/v1/targets` | target lists |
| GET | `/api/v1/modules` | module states |
| GET | `/api/v1/modules/{name}` | one module's full detail, including every setting |
| GET | `/api/v1/settings` | (405) — settings are written with POST |
| POST | `/api/v1/settings` | change one setting: `{"module","setting","value"}` |
| GET | `/api/v1/profiles` | every profile with its range, sort mode and guards |
| POST | `/api/v1/profiles/{name}` | switch the active profile |
| GET | `/api/v1/hud` | every HUD element and whether it is shown |
| POST | `/api/v1/hud/{name}` | toggle one HUD element |
| POST | `/api/v1/hunter/{action}` | lifecycle: `start`, `stop`, `emergency-stop`, `clear-stop`, `pause`, `resume`, `save`, `status` |
| GET | `/api/v1/stats` | statistics counters |
| GET | `/api/v1/events?since=&limit=` | recent combat events |
| GET | `/api/v1/tasks` | current session and target as tasks |
| POST | `/api/v1/command` | run a command (same set as `.hunter`/`.target`) |
| POST | `/api/v1/notify` | show a local chat notification |
| POST | `/api/v1/bot/{status,pause,resume,stop}` | bot lifecycle |

Authentication: `Authorization: Bearer <token>` or `?token=<token>` (the query form exists because
browsers' `EventSource` cannot set headers).

```bash
# Health is public.
curl http://127.0.0.1:8720/health

# Everything else needs the token.
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8720/api/v1/snapshot

# Commands are the same vocabulary as the in-game commands.
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"command":"target add Griefer priority"}' \
  http://127.0.0.1:8720/api/v1/command
```

Remote access (`allow-remote`) is off by default and binds the socket to loopback. Enable it only
on a trusted network.

---

## Logvex Worker (mod)

`worker-mod/` is a second, independent Fabric mod. Where the Hunter addon is a *monitoring* tool,
the Worker is a *remote-controlled client*: it dials out to the Fleet Manager host over a WebSocket
and answers a closed set of named tasks. It is deliberately narrow.

- **Outbound only.** The worker connects to the host; the host never connects to the worker. A
  client that is offline simply is not in the roster.
- **A closed task set, not code.** The host sends one of the message types in `Protocol.java` with a
  validated payload (`status`, `inventory`, `count`, `search`, `equipment`, `regear`, `command`,
  `chat`, `position`, `efly`). The worker dispatches through a fixed switch. There is no shell, no
  class name, no eval — that is what keeps the protocol from becoming remote code execution.
- **It answers with what it observed.** A task result carries the value the client actually read
  (inventory, durability, coordinates), and the host records that, not an assumption.
- **No combat.** There is no attack task kind. `efly` steers the client with its *own* Meteor
  `ElytraFly` and `PathManagers`; nothing aims or fights.
- **It logs to the host.** The worker forwards its own link log as throttled `log` frames, so the
  Fleet Manager's **Console** tab shows the client's view (connect, register, task outcomes, errors).

Full protocol, command allow-list, `efly` payload reference, installation and build instructions are
in [`worker-mod/README.md`](worker-mod/README.md); the wire contract itself is written down in
[`docs/PROTOCOL.md`](docs/PROTOCOL.md).

---

## Logvex Fleet Manager (desktop app)

The Fleet Manager is a separate Electron application under `fleet-manager/`. It is a **control
plane**: it never launches Minecraft and holds no game account. Instead, each bot is a real
Minecraft client running the **Logvex Worker** mod, which dials *out* to the host — so the host never
needs an inbound port on a bot machine, and works from behind NAT. The host is where you watch the
fleet (live state, inventory, coordinates, health, gear), pair new workers with a short code, and
dispatch a closed set of tasks (status, inventory, count, search, equipment, regear, command, chat,
position, efly) to one worker or many, reading back the result each client actually reported.

See [`fleet-manager/README.md`](fleet-manager/README.md) for the full feature list, architecture,
build and packaging instructions, and screenshots in `fleet-manager/docs/screenshots/`.
The end-to-end walkthrough for both halves is in [`USAGE.md`](USAGE.md).

---

## Two control planes, deliberately separate

The desktop host talks to **Logvex Worker** clients over the worker WebSocket. The in-game swarm
talks to **LogVex Hunter** clients over its own host/hunter protocol. The **companion API** is a
third, inbound-only surface on a Hunter client (read state, send commands) meant for a browser or a
script. They are independent: the desktop host does not read a worker's world state except through
that worker's own reports, and it does not assume one client's state is visible to another.

---

## Repository layout

```
.
├── build.gradle.kts, settings.gradle.kts, gradle/   # LogVex Hunter Gradle build
├── docs/PROTOCOL.md                                 # the worker wire contract, written down
├── src/main/java/com/logvex/hunter/                 # the addon (the only Hunter mod)
│   ├── core/            Minecraft-free logic (unit-tested): targets, stats, messages, stasis,
│   │                    equipment, instances, swarm, companion router/server
│   ├── mc/              game bridge: runtime, chat, player scanner
│   ├── modules/         the Meteor modules (incl. modules/swarm — Host/Hunter)
│   ├── gui/             ClickGUI dashboard and screens
│   ├── hud/             HUD elements
│   └── companion/       game-layer companion API + command handling
├── src/test/java/com/logvex/hunter/                 # addon unit tests
├── worker-mod/                                      # the Logvex Worker Fabric mod
│   ├── src/main/java/com/logvex/worker/
│   │   ├── core/        Minecraft-free protocol, link, validation (unit-tested)
│   │   ├── mc/          game bridge: status, inventory, container moves, efly executor
│   │   └── meteor/      the Fleet Manager category + modules
│   └── src/test/java/com/logvex/worker/             # worker unit tests (real-socket link tests)
└── fleet-manager/                                   # the Electron desktop application
```

## Testing

```bash
# Addon (from the repository root)
export JAVA_HOME=/path/to/jdk-25
./gradlew clean test build

# Fleet Manager
cd fleet-manager
npm install
npm test
```

The addon's Minecraft-free core is covered by JUnit tests (targets, statistics, messages, stasis,
configuration, the swarm protocol/handshake/roster/command-gate, the companion router and a
real-socket companion server test). The Fleet Manager has unit and integration tests run with
Vitest.

## License

MIT — see [LICENSE](LICENSE).
