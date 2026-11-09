# Changelog

All notable changes to the products in this repository are documented here: **LogVex Hunter** (the
single Meteor Client addon, which also provides the in-game Host/Hunter swarm) and the **Logvex
Fleet Manager** desktop app. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-11-08

### Added
- **In-game swarm: control many LogVex Hunter clients from one host, in the game.** A new `swarm`
  module makes one client the **host** and the rest **hunters**, in the spirit of Meteor's own
  Swarm. It is the only mod involved — no server, no separate worker mod, no external app.
  - New Minecraft-free core (`com.logvex.hunter.core.swarm`): a newline-delimited JSON protocol
    (`SwarmProtocol`, `SwarmMessage`), the token handshake (`SwarmHandshake`), the host roster with
    id/label/index routing (`SwarmRoster`, `SwarmPeer`), a bounded line reader (`SwarmLineReader`)
    and the broadcast safety gate (`SwarmCommandGate`).
  - Transport: `SwarmHostServer` accepts and authenticates hunters; `SwarmHunterClient` connects,
    handshakes and receives commands. Sockets run on daemon threads; commands are queued and drained
    on the client tick, so the game thread never blocks.
  - A hunter runs every host command through the same control layer as the local player, so the
    host can drive each hunter's target list, modules, settings, profiles and HUD.
  - **Swarm screen** (dashboard → Swarm, or `.swarm gui`): mode switch, live roster, per-hunter kick
    and a broadcast box.
  - **Swarm HUD** (`logvex-swarm`): host/hunter state, port and live hunter list.
  - Chat commands: `.swarm host|join|stop|connections|send|broadcast|kick|token|port|status|gui`.
  - **Safety.** Broadcasts are limited to read-only, cosmetic and non-combat tuning commands
    (`status`, `save`, `settings`, `set` of a non-combat setting, `profile`, `hud`, `target`,
    `notify`); lifecycle changes and anything that would arm combat on the whole fleet are refused
    unless `allow-combat-broadcast` is on. A single-hunter send that arms combat still warns.
    `emergency-stop` always broadcasts, and the host sends it to the fleet on its own emergency stop
    before the link is torn down. The link requires a shared token and binds to loopback unless
    `allow-remote` is enabled.
  - Config gains `swarmHostPort`, `swarmHostToken`, `swarmHostAllowRemote`, `swarmHunterHost`,
    `swarmHunterPort`, `swarmAllowCombatBroadcast`, `swarmAutoConnect` and `swarmHostMode`.
- **Full remote control surface for the Hunter, shared by chat and the Fleet Manager.** A new
  Minecraft-free control layer (`com.logvex.hunter.core.control`) parses a single text grammar into
  typed actions and dispatches them through a `ControlTarget`. The in-game chat commands, the
  companion HTTP API and the Control screen all run through this one layer, so they can never drift
  apart.
  - Read and change **any module setting** remotely: `.hunter get [module]` lists every setting,
    `.hunter set <module> <setting> <value>` changes one. Over HTTP:
    `GET /api/v1/modules/{name}` and `POST /api/v1/settings`.
  - Switch, create, delete and save **profiles**: `.hunter profile use|create|delete|save`.
    Over HTTP: `GET /api/v1/profiles` and `POST /api/v1/profiles/{name}`.
  - List and toggle **HUD elements**: `.hunter hud [list|<element>]`. Over HTTP: `GET /api/v1/hud`
    and `POST /api/v1/hud/{name}`.
  - **Hunter lifecycle** over HTTP: `POST /api/v1/hunter/{start|stop|emergency-stop|clear-stop|pause|resume|save|status}`.
  - Richer **target control**: `.target note|priority|category`.
- **Control screen** (`com.logvex.hunter.gui.control.ControlScreen`, opened with `.hunter control` or
  the dashboard's Control button). It edits any module's settings by type (checkboxes for booleans,
  dropdowns for enums, text boxes otherwise), switches and saves profiles, and toggles HUD elements —
  all through the same control layer the API uses.
- Dashboard quick-control row: an active-profile dropdown, Save profile and Reload buttons.

### Performance
- **The dashboard no longer rebuilds its widgets every tick.** Every screen refreshed its whole
  widget tree 20 times a second — the dashboard's recent-events table, the instances table (which
  holds live checkboxes and buttons), and the stasis, equipment and statistics tables all cleared and
  re-created every row on every tick. Besides the allocation churn, this could drop a click on a
  button that was recreated mid-press. Each table now rebuilds only when the data it shows actually
  changes: the dashboard keys off a new `Statistics.eventRevision()` counter, the others off cheap
  change signatures, and the statistics tables refresh twice a second. The visible text still updates
  live.
- **HUD elements no longer allocate per frame.** Each element built a fresh `ArrayList` (and the
  statistics element a `String.format`) on every frame; lines are now assembled into one reusable
  buffer per element.
- **Stasis assessment runs once per tick instead of once per frame plus once per tick.** The HUD
  reads the cached assessment and readiness for the tick it is drawn in.
- **Equipment warnings are evaluated at most ten times a second** instead of on every tick and every
  equipment-screen refresh.

### Changed
- **Fabric Loader 0.19.5 to 0.20.1** (latest stable).
- Mod version **1.0.0 to 1.1.0**.
- **Consolidated to a single mod with two swarm modes, Host and Hunter.** The standalone
  `worker-mod/` Fabric mod has been removed; controlling other clients is done entirely in game by
  the one LogVex Hunter addon. In the swarm, the former **worker** mode is now **hunter** mode and is
  fully controlled by the host.
  - Renamed throughout: `Mode.WORKER` → `Mode.HUNTER`, the "Worker" settings group and its
    `host`/`port`/`token` settings, the `SwarmWorkerClient` class, the roster/HUD/screen wording and
    the `.swarm send|broadcast|kick <hunter>` arguments.
  - Config keys `swarmWorkerHost`/`swarmWorkerPort` are now `swarmHunterHost`/`swarmHunterPort`; the
    old keys are still read once so an existing config keeps its host address.

### Fixed
- **The built jar now targets Java 21 instead of Java 25.** Minecraft 1.21.11 and Meteor
  1.21.11-SNAPSHOT run on Java 21, so the previous jar (Java 25 bytecode, `"java": ">=25"` in
  `fabric.mod.json`) would have been rejected by Fabric Loader and could never load. The mod is now
  compiled with `--release 21` and declares `"java": ">=21"`.
- The build now runs directly on JDK 25 instead of a Gradle toolchain, and fails early with a
  readable message if the JDK is older than 25. JDK 25 is required *to build* because Fabric Loom
  1.18 needs a Java 25 runtime (resolved in the JVM that runs Gradle); the mod itself is still
  compiled to Java 21 bytecode.

## [1.0.0] - 2026-11-08

Initial release. LogVex Hunter is a Meteor Client addon for Minecraft 1.21.11 (Fabric) that
provides target management, combat coordination, equipment and stasis monitoring, statistics and a
local companion API for the Logvex Fleet Manager.

### Added

#### Core
- Minecraft-free core (`com.logvex.hunter.core`) with target lists, statistics, message templates,
  stasis evaluation, equipment snapshots, instance probing and a JSON helper — all unit-tested.
- Persistent JSON configuration under `config/logvex-hunter/` with atomic writes and automatic
  backup-and-reset recovery from corrupt files.

#### Hunter Dashboard
- A dedicated ClickGUI tab and dashboard screen showing system status, current target, coordinates,
  distance, health and armour, equipment, active modules, session statistics and recent combat
  events.
- Start/Stop and emergency-stop controls, configuration profiles, per-module toggles and a save-all
  action.
- Secondary screens: combat, equipment, instances, messages, statistics, stasis, targets,
  profiles and companion.

#### Player Tracking / Target Manager
- Target categories: priority, bot, opponent, temporary, friend and ignore; protected categories
  (friend/ignore) are never selectable.
- Configurable filters (friends, ignore list, naked players, invisible, creative, weapon
  requirement), last-known-position tracking, distance calculation, target history, configurable
  sort order, automatic target selection and manual switching with a cooldown.
- CSV/JSON import and export of the target list.

#### Combat Integration
- Coordinates Meteor's `KillAura`, `AutoWeapon`, `AutoTotem`, `AutoArmor` and `AutoEat` rather than
  reimplementing them, and can disable `CrystalAura`/`AnchorAura` to prevent conflicts.
- Combat module status monitoring, configurable combat profiles, emergency combat disable and
  friend/ignore-list protection.

#### Equipment Manager
- Armour, durability, totem and food monitoring with configurable thresholds and warning
  cooldowns; missing-equipment warnings; inventory status dashboard.

#### Configurable Chat Messages
- Message profiles with multiple templates per event, per-template enable and cooldown, random
  selection and previews.
- Placeholders: `{player}`, `{username}`, `{uuid}`, `{distance}`, `{health}`, `{armor}`,
  `{weapon}`, `{server}`, `{coordinates}`, `{category}`, `{priority}`, `{time}`.
- Local notifications by default; sending to the server is opt-in.

#### Multi-Instance Management
- Register other clients and poll their read-only statistics over an authenticated HTTP endpoint;
  per-instance emergency stop and isolation. No client's world state is assumed visible to another.

#### Defensive Stasis System
- Readiness levels (SAFE/CAUTION/DANGER/CRITICAL) derived from health, totems, food, armour and
  durability; connection-loss detection; configurable thresholds; recovery dashboard and manual
  emergency controls. Observation only — it never attacks.

#### Statistics
- Kills, deaths, sessions, duration, encounters, equipment usage, module activations, K/D and
  recent events, with JSON/CSV export and a session history.

#### HUDs and Commands
- HUD elements: target, equipment, hunter status, stasis and statistics.
- Commands: `.hunter`, `.target` and `.hstats` with their subcommands.

#### Companion API
- A loopback HTTP endpoint (`/health`, `/api/v1/*`) with bearer-token authentication and an
  optional `?token=` query form, so the Logvex Fleet Manager and a browser can read state and send
  commands. Remote binding is off by default.

### Notes
- The addon is a monitoring and coordination tool; it adds no unattended combat automation of its
  own.
- Requires Meteor Client 1.21.11-SNAPSHOT and Fabric Loader 0.19.5.

[1.1.0]: https://github.com/logvex-sg/Botsv1/releases/tag/v1.1.0
[1.0.0]: https://github.com/logvex-sg/Botsv1/releases/tag/v1.0.0
