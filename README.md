# Logvex Fleet Manager ecosystem

Two cooperating products live in this repository:

| Product | What it is | Where |
| --- | --- | --- |
| **LogVex Hunter** | A Meteor Client addon for Minecraft 1.21.11 (Fabric). Target tracking, combat coordination, equipment and stasis monitoring, statistics, and a local companion API. | repository root (`src/main/java/com/logvex/hunter`) |
| **Logvex Fleet Manager** | An Electron + React + TypeScript desktop app that manages many Minecraft bot instances, and reads/controls one or more LogVex Hunter clients over the companion API. | `fleet-manager/` |

The two halves are designed to work together: the Hunter addon serves an authenticated local
HTTP endpoint, and the Fleet Manager connects to it. See
[Companion API](#companion-api-the-hunter--fleet-manager-bridge) below.

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
- **Defensive Stasis System** — readiness levels (SAFE/CAUTION/DANGER/CRITICAL) from health,
  totems, food, armour and durability, with connection-loss detection and a recovery dashboard.
  Observation only: it never attacks.
- **Statistics** — kills, deaths, sessions, duration, encounters, equipment usage, module
  activations, K/D, recent events; JSON/CSV export.
- **Companion API** — a loopback HTTP endpoint (see below) that exposes read-only state and the
  same administrative commands as the in-game commands.

### Requirements

- Minecraft 1.21.11 with Fabric Loader 0.19.5
- [Meteor Client](https://meteorclient.com/) 1.21.11-SNAPSHOT
- Java 21 runtime (the mod targets Java 21, so it loads on a stock 1.21.11 install)
- **JDK 25** to build the addon — Fabric Loom 1.18 requires a Java 25 runtime (the mod itself is compiled to Java 21 bytecode)

### Installation

1. Install Fabric Loader for Minecraft 1.21.11.
2. Put Meteor Client in your `mods` folder.
3. Build the addon (see below) and copy `build/libs/logvex-hunter-1.0.0.jar` into `mods`.
4. Launch the game. The addon registers a **Logvex Hunter** category and ClickGUI tab.

### Building

```bash
# The build must run on JDK 25 (Fabric Loom 1.18 requires a Java 25 runtime).
# The mod itself is compiled to Java 21 bytecode and runs on Java 21.
export JAVA_HOME=/path/to/jdk-25
./gradlew clean test build
```

The remapped, release-ready jar is written to `build/libs/logvex-hunter-1.0.0.jar`.

### Commands

See [`USAGE.md`](USAGE.md) for the full use guide. The command reference:

```
.hunter                       # status summary
.hunter status
.hunter start | stop
.hunter emergency-stop | clear-stop
.hunter gui                   # open the dashboard
.hunter modules               # list module states
.hunter toggle <module>
.hunter profile               # list profiles
.hunter companion [status|start|stop|token|regenerate|port <n>]
.hunter save

.target list [category]
.target add <player> [category]
.target remove <player>
.target focus <player>
.target clear
.target current
.target gui

.hstats [show|sessions|events|export|reset|gui]
```

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

## Logvex Fleet Manager (desktop app)

The Fleet Manager is a separate Electron application under `fleet-manager/`. It manages accounts,
server profiles, groups, deployments and bot roles (GEARER/STASIS/HUNTER), tracks a target
database, and connects to one or more LogVex Hunter clients. Each bot runs in its own isolated
Node worker process, so a crash or hang in one never takes down the app.

See [`fleet-manager/README.md`](fleet-manager/README.md) for the full feature list, architecture,
build and packaging instructions, and screenshots in `fleet-manager/docs/screenshots/`.
The end-to-end walkthrough for both halves is in [`USAGE.md`](USAGE.md).

---

## Repository layout

```
.
├── build.gradle.kts, settings.gradle.kts, gradle/   # LogVex Hunter Gradle build
├── src/main/java/com/logvex/hunter/                 # addon source
│   ├── core/            Minecraft-free logic (unit-tested): targets, stats, messages, stasis,
│   │                    equipment, instances, companion router/server
│   ├── mc/              game bridge: runtime, chat, player scanner
│   ├── modules/         the Meteor modules
│   ├── gui/             ClickGUI dashboard and screens
│   ├── hud/             HUD elements
│   └── companion/       game-layer companion API + command handling
├── src/test/java/com/logvex/hunter/                 # addon unit tests
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
configuration, the companion router and a real-socket companion server test). The Fleet Manager has
unit and integration tests run with Vitest.

## License

MIT — see [LICENSE](LICENSE).
