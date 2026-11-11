# Changelog

All notable changes to the products in this repository are documented here: **LogVex Hunter** (the
single Meteor Client addon, which also provides the in-game Host/Hunter swarm) and the **Logvex
Fleet Manager** desktop app. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [6.0.0] - 2026-11-11

### Fixed
- **Hunter addon: the event pipeline now actually reaches the modules.** Core events were posted
  only to the addon's own bus while most modules listened with Meteor's `@EventHandler`, so a whole
  class of listeners never ran. `HunterCore.publish` now also forwards to a sink the game layer
  installs (`HunterRuntime` → `MeteorClient.EVENT_BUS`), so `TargetSwitched`, `LocalPlayerDied`,
  `InstanceStatusChanged` and friends reach every listener. The core stays Minecraft-free and
  unit-testable.
- **Hunter addon: kills are recorded again.** `TargetEliminated` was never published and
  `HunterCore.recordKill` had no reachable caller, so the kill counter stayed at zero. A new
  `EliminationLog` (Minecraft-free, unit-tested) confirms an elimination only when a player the
  local player recently struck vanishes while at low health, and `HunterCore.recordElimination`
  updates the statistics, the target entry, that player's history and the combat log in one place.
  A plain disappearance is still not a kill.
- **Worker: regear now equips carried armour.** The only move the worker performed was a container
  quick-move, so a regear that needed armour but had no container open could never satisfy the
  loadout. `ContainerMover.equipCarriedArmor` shift-clicks carried armour into empty armour slots
  (using the item's `EQUIPPABLE` component), and regear runs it before any container withdrawal.
- **Fleet Manager: the task console can now drive every task kind.** The Tasks page had a parameter
  form for only a handful of kinds, so container, shulker, restock and portal tasks could not be
  configured from the UI. The form is now schema-driven and covers all 17 kinds the worker
  implements.

### Added
- **Fleet Manager: HIVE MODE — coordinated multi-bot command (spec §7).** A new swarm command layer
  turns the roster from many independent workers into one coordinated unit. `packages/hive/` holds
  the Minecraft-free, unit-tested engine: a closed instruction parser (`commands.ts`), formation
  geometry (`formations.ts`), sector planning and summarising (`sectors.ts`), and observation models
  (`observations.ts`). `HiveService` is the stateful coordinator: it assigns roles, elects a
  commander, computes formation offsets, derives role-appropriate objectives, hands each objective to
  exactly one worker, records shared observations and keeps a command history. Migration
  `0010_hive_mode` adds `hive_roles`, `hive_objectives`, `hive_observations`, `hive_commands`,
  `hive_sectors` and `hive_state`, round-tripped by `HiveRepository`. Crucially, an order is
  dispatched through the **same** task path the UI uses, so a hive command is validated and reported
  exactly like a hand-sent task. The renderer gains a **HIVE MODE** page: a live canvas map (worker
  positions, formation targets, explored sectors, shared sightings), the swarm roster with per-worker
  role and health, the shared objective queue, the shared intelligence, a role manager and the
  command history, with Start/Stop and a one-click **Emergency stop**. IPC channels `hive:*`, a
  `fleet.hive*` bridge and REST routes under `/api/v1/hive/*` expose the whole surface. New events:
  `HIVE_STATE`, `HIVE_COMMANDER`, `HIVE_ROLE`, `HIVE_FORMATION`, `HIVE_COMMAND`,
  `HIVE_EMERGENCY_STOP`, `HIVE_OBSERVATION`.
- **Fleet Manager: the `nl-task` wire kind is now first-class.** The natural-language task kind the
  Worker mod and the bot runner already implement is defined in the task library, mapped in
  `capabilities.ts`, and added to the mod's `TaskCatalog`, so the Host can offer it and the protocol
  drift check stays green.
- **Fleet Manager: the structure registry (spec §9) is now wired end to end.** The
  `structure-registry` engine — region validation, point-in-structure tests and change-impact
  previews — was implemented and unit-tested but only reachable from tests. It now has a persistent
  home: migration `0009` adds a `structures` table, `StructureRepository` round-trips it, and
  `StorageService` exposes `listStructures`/`createStructure`/`updateStructure`/`removeStructure`,
  plus `structureIssues`, `structuresDueForMaintenance`, `previewStructureChange` and
  `structureCounts`. The **Structures** tab in the Storage page drives it through the real service:
  register a storage room, farm, workshop, processing area, temporary build or other region, mark it
  protected, set its maintenance state, and see the flagged list. Registered portals are projected
  into the same list (and the same dashboard) rather than duplicated. The tab's **Preview change**
  dialog runs `previewStructureChange` over an arbitrary region and reports which structures a change
  would touch, whether each is actionable, and why not — a protected structure is always listed as
  not actionable. IPC channels `storage:structures:*` and a `fleet.*` bridge method expose the whole
  surface to the renderer.
- **Fleet Manager: the maintenance assistant now shows the AI plan.** The AI planner (spec §13)
  was implemented and tested but nothing called it. `storage.ask` now runs both engines over the
  same sentence: the maintenance assistant maps it to an executable operation, and the planner
  returns a checked plan (recognised intent, ordered steps, which are authorised, which are
  destructive). The assistant tab renders the plan, and a deterministic planner with no match is
  still reported honestly rather than guessed at.
- **Worker: in-game commands for every storage feature (spec §16).** `.worker` gained `position`,
  `equipment`, `container <x> <y> <z>`, `shulkers`, `pack <query>`, `unpack`,
  `restock <query> [limit]` and `portals [remove]`, so each storage capability can be exercised from
  the client without the host.
- **Fleet Manager: complete task library.** The task library now defines the seven storage kinds
  (`container-read`, `container-move`, `shulker-read`, `shulker-pack`, `shulker-unpack`, `restock`,
  `portal-scan`) that the worker already implemented, so capability validation and the task
  definitions cover the full set the protocol advertises. A test asserts the library covers every
  wire kind.
- **Hunter addon: more lifecycle events.** `ModuleStateChanged` is published from the module base
  class for every module, and the runtime publishes `ConnectionChanged` and `LocalHealthChanged`.
- **Hunter addon: configurable elimination announcements.** `NotificationModule` gained
  `notify-eliminated`, and the dashboard gained `detect-eliminations` and `elimination-window`.
- **Packaging: one release per version, with per-platform installers.** The Fleet Manager now
  publishes a Windows NSIS installer and Debian Linux `.deb` + `.AppImage` alongside the two
  platform-independent mod jars, with checksums and a [`docs/RELEASE.md`](docs/RELEASE.md) guide
  explaining which file to pick. `electron-builder`'s output moved to `release/` so a build no longer
  packages its own previous artifacts, and the app now declares its repository so update-info
  generation does not fail.
- **Packaging: a landing page and a code-signing certificate.** [`docs/index.html`](docs/index.html)
  is a GitHub Pages download page (published at <https://logvex-sg.github.io/Botsv1/>) that links
  every artifact for the current release and repoints itself at the newest release through the
  GitHub API. The Windows installer is now Authenticode-signed with a self-signed project certificate
  and a DigiCert timestamp — see [`docs/SIGNING.md`](docs/SIGNING.md) and
  [`scripts/sign-windows.sh`](scripts/sign-windows.sh). The certificate proves the file is unmodified
  but, being self-signed, does not remove the SmartScreen warning.

### Changed
- **The Fleet Manager is now a host, not a bot runner.** `host/` was rebuilt around one
  idea: the desktop app *controls* workers, it does not *run* bots. It no longer launches Minecraft,
  holds no game account, and needs no inbound port on a bot machine. Each bot is a real Minecraft
  client running the **Logvex Worker** mod, which dials *out* to the host over a WebSocket.
  - The whole parallel `mineflayer` subsystem is gone (accounts, servers, deployments, instances,
    targets, stasis, roles, hunter client, credential vault). The Host has no place to type a
    password because it never logs in.
  - New navigation and pages: **Dashboard**, **Workers**, **Groups**, **Tasks**, **Inventory**,
    **Regear**, **Commands**, **Consoles**, **Settings**, with a first-run **Host mode / Worker
    mode** chooser.
  - The database was rewritten for the host schema; the retired tables are dropped by a migration.
    Live connection state stays in memory; the roster, groups, task history, command audit log,
    inventory cache and regear presets are persisted.
  - The local HTTP API is host-scoped (`/api/v1/workers*`, `/api/v1/status`); `/health` stays open
    and the rest needs the bearer token.

### Added
- **Worker Mode: the desktop app can now act as a worker.** A new **Worker Mode** page in the
  desktop app connects *this* machine out to a host, using the same wire protocol the Fabric mod
  speaks. It is the counterpart to the Workers page: where that drives other people's clients, this
  configures this one to be driven. Its main jobs are to validate a host before an operator commits,
  and to write the `logvex-worker.json` that is dropped into each bot's `mods/` folder.
  - A real protocol client in the main process (`src/main/worker-mode/worker-client.ts`) that pairs
    with a token or a one-time code, registers, heartbeats, answers `ping`, and reports its
    `paused`/`stopped` state. It is honest about what it is: with no Minecraft client attached it
    answers a `status` request but refuses game tasks explicitly.
  - Worker Mode settings live under their own key and are never mixed with the host's, so a machine
    cannot end up half-host and half-worker.
  - A one-shot **Test connection** button that reports the handshake result without leaving a
    phantom worker registered on the host.
- **Remote control from the host.** New `control` message (protocol v3) with `connect`,
  `disconnect`, `restart`, `pause` and `resume`. `pause` blocks mutating tasks while read-only tasks
  keep running; `disconnect` marks a worker stopped but reachable; `restart` re-applies the link.
  The worker stamps `paused`/`stopped` onto every snapshot, so the host reads the real state rather
  than assuming the action took effect.
- **Bulk controls and per-worker controls** on the Workers page (Connect, Pause, Resume, Restart,
  Disconnect, plus a select-all checkbox), and a `POST /api/v1/workers/:id/control` route on the
  local HTTP API for the same actions from a script.
- **Worker pairing codes.** The host can mint a short, single-use, expiring code (for example
  `ABCD2345`). A worker's first `hello` may carry it instead of the long-lived token; the host
  answers with the shared token and consumes the code. The worker stores the token and uses it on
  every later reconnect, so enrolling a bot no longer means copying a long secret onto the bot
  machine by hand.
- **Worker protocol v3.** `Protocol.VERSION` is now `3`; the outbound `control` message was added
  and snapshots carry `paused` and `stopped`. The three protocol mirrors (`protocol/protocol.json`,
  `host/src/shared/workers.ts`, `worker-mod/.../Protocol.java`) and the canonical checker
  (`protocol/check-protocol.mjs`) are all in step.
- **Worker protocol v2.** `Protocol.VERSION` was `2`; the `hello` payload gained `pairingCode`,
  and a successful `hello-ack` may carry a granted `token`. Both sides still refuse a version
  mismatch rather than coercing it, and the host-side drift test now also pins the pairing field so
  the two declarations cannot silently diverge.

### Fixed
- **The Fleet Manager's database no longer loses its worker tables.** A rewrite pass had dropped the
  migration that *creates* them while adding the host-schema migration that drops the retired ones,
  which made every worker write fail with `no such table: workers`. The creating migration is
  restored ahead of the dropping one.

### Added
- **Real item classification, end to end.** Items are no longer assumed interchangeable. The worker
  reads the four facts that actually distinguish two stacks off the live `ItemStack` —
  `tags`, `enchantments`, `components` and `customName` (`ItemMetadata`) — and reports them on every
  item, in the carried inventory, a container read and a shulker read alike. The host's `WorkerItem`
  carries the same optional fields, and the storage engine routes by *classification* rather than a
  bare id match: `packages/item-classifier` decides the category from metadata when it is present,
  and the classifier-aware `chooseDestination` picks the container dedicated to that category. When a
  worker reports no metadata a category with no rules still falls back to its substrings, so an older
  worker is understood and a tag that was never read is treated as unknown, never as absent.
- **Storage categories now carry real classifier rules, and those rules actually drive routing.**
  A category is no longer just a list of id substrings projected onto the classifier; it stores a
  list of `ClassifierRule`s (`tag`, `enchantment`, `component`, `namespace`, `custom-name`,
  `id-equals`, `id-contains`, `durability`, `stackable`) that are read straight off the item's
  reported metadata. `StorageCategory.rules` is persisted (migration `0008` adds the column, and the
  repository round-trips it), a fresh install is seeded with the built-in rule families rather than
  substring lists, and the storage service builds one classifier per plan and classifies every item
  through it — so the tags/enchantments/components/namespace classifier is the live code path, not a
  projection of the substrings. The **Categories** tab in the Storage page views and edits these
  rules (add, change kind, remove) through the real service, and a category with no rules keeps the
  substring fallback.
- **The worker's controls are now available in-game.** `.worker` registers with Meteor's command
  system: `status`, `config`, `events`, `connect`/`disconnect`/`reconnect`, `pause`/`resume`,
  `enable`/`disable`, `inventory`, `count`, `search`, and `inspect` — which prints the real tags,
  enchantments and components of matching carried stacks. The pause/resume/stop methods are the same
  ones the host's control frames call, so the two paths cannot diverge; a regression test drives both
  and asserts they gate tasks identically.


- **The Logvex Worker mod is back, as the Fleet Manager's outbound half.** A second, independent
  Fabric mod under `worker-mod/` dials the Fleet Manager host over a WebSocket and answers a closed
  set of named tasks. It is outbound only (the host never connects to the worker), it dispatches a
  fixed set of message types with validated payloads rather than code, and it has no combat task
  kind. See [`worker-mod/README.md`](worker-mod/README.md).
  - New Minecraft-free core (`com.logvex.worker.core`): the newline-framed JSON envelope
    (`Envelope`), the protocol constants (`Protocol`), the handshake/task link (`WorkerLink`) over a
    hand-rolled WebSocket client, the command allow-list (`CommandValidator`), and the
    inventory/equipment/efly value types — all unit-tested.
  - New game layer (`com.logvex.worker.mc`): status and inventory readers, container moves for
    regear, and the EFly executor that drives Meteor's own `ElytraFly` and `PathManagers`.
  - New Meteor integration (`com.logvex.worker.meteor`): the **Fleet Manager** ClickGUI category and
    its modules (connection, information, task status, inventory monitor, item counter, equipment
    manager, regear manager, remote control, EFly).
  - Wired into the root Gradle build as the `worker-mod` subproject, producing its own release jar.
- **EFly task end-to-end.** The worker can engage or stop the client's own elytra flight and fly to
  target coordinates, with optional `mode`, `minHeight`, `useFireworks` and `startPathing`. The
  payload is validated in `EflyRequest` before it can reach the client. The Fleet Manager's **Tasks**
  tab gained an EFly form and the task kind is exposed on the API.
- **Worker console streaming.** The worker forwards its own link log to the host as throttled `log`
  frames (at most one a second). The host keeps a bounded, per-worker buffer (200 lines) and exposes
  it through a new **Console** tab in the Fleet section, plus `GET`/`DELETE
  /api/v1/workers/{id}/console`. This shows what the client itself saw, not what the host assumed.
- **Exclusive mutating tasks.** The host refuses to start a second mutating task (`regear`,
  `command`, `chat`, `efly`) on a worker that already has one in flight, so a flight and a regear can
  never race.

### Changed
- **The single-mod scope note no longer applies to the worker direction.** Controlling other clients
  is still possible entirely in game with the one Hunter addon's **swarm** module, but the Fleet
  Manager also drives a separate **worker** fleet again; both directions are documented in the
  README.

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
