# Logvex Hunter — full use guide

This guide covers both products in this repository end to end: the **LogVex Hunter** Meteor addon
and the **Logvex Fleet Manager** desktop app, and how to wire them together.

- [1. What the ecosystem does](#1-what-the-ecosystem-does)
- [2. Requirements](#2-requirements)
- [3. Install the addon](#3-install-the-addon)
- [4. First run: get the dashboard open](#4-first-run-get-the-dashboard-open)
- [5. The dashboard](#5-the-dashboard)
- [6. Target Manager](#6-target-manager)
- [7. Combat coordination](#7-combat-coordination)
- [8. Equipment manager](#8-equipment-manager)
- [9. Messages and placeholders](#9-messages-and-placeholders)
- [10. Defensive stasis](#10-defensive-stasis)
- [11. Statistics](#11-statistics)
- [12. Multi-instance management](#12-multi-instance-management)
- [13. The companion API](#13-the-companion-api)
- [14. Fleet Manager: install and run](#14-fleet-manager-install-and-run)
- [15. Fleet Manager: pages and workflow](#15-fleet-manager-pages-and-workflow)
- [16. Connecting the Fleet Manager to the addon](#16-connecting-the-fleet-manager-to-the-addon)
- [17. Configuration files](#17-configuration-files)
- [18. Command reference](#18-command-reference)
- [19. Module reference](#19-module-reference)
- [20. Troubleshooting](#20-troubleshooting)

---

## 1. What the ecosystem does

**LogVex Hunter** (the addon) runs inside Minecraft. It:

- detects nearby players and maintains prioritised **target lists** (priority / bot / opponent /
  temporary / friend / ignore),
- selects a target and **coordinates Meteor's own combat modules** (KillAura, AutoWeapon,
  AutoTotem, AutoArmor, AutoEat) around it — it does not reimplement them,
- monitors equipment, durability, totems and food,
- watches defensive readiness ("stasis") from health, totems, food and armour,
- sends **configurable chat messages** on combat events,
- records **statistics** and exports JSON/CSV,
- optionally **registers other clients** and polls their read-only stats,
- serves a local, authenticated **companion HTTP API** so a desktop app can read and control it.

**Logvex Fleet Manager** (the desktop app) manages many bot accounts and instances: accounts,
server profiles, groups, deployments, bot roles (GEARER / STASIS / HUNTER), a target database,
an event log, and a connection to one or more Hunter clients.

> **Scope.** The addon observes, records and coordinates Meteor's own modules around a target that
> is selected manually or by its filters. It adds no unattended combat automation of its own. The
> HUNTER role in the Fleet Manager requires an explicit authorisation toggle and a target
> allowlist before it will engage anything, and is meant for private test environments.

---

## 2. Requirements

| Component | Requirement |
| --- | --- |
| Minecraft | 1.21.11 |
| Mod loader | Fabric Loader 0.19.5+ |
| Meteor Client | 1.21.11-SNAPSHOT |
| Java (runtime) | 21 |
| Java (to build the addon) | **JDK 25** (Fabric Loom 1.18 needs a Java 25 runtime) |
| Fleet Manager | Node.js 20+ and npm |

---

## 3. Install the addon

1. Install Fabric Loader for Minecraft 1.21.11.
2. Put `meteor-client-1.21.11-SNAPSHOT.jar` into `.minecraft/mods/`.
3. Build the addon and copy the jar into the same folder:

   ```bash
   # The build needs JDK 25 (Fabric Loom 1.18 requires a Java 25 runtime).
   # The mod itself is compiled to Java 21 bytecode and runs on Java 21.
   export JAVA_HOME=/path/to/jdk-25
   ./gradlew clean test build
   cp build/libs/logvex-hunter-1.0.0.jar ~/.minecraft/mods/
   ```

4. Start the game. A **Logvex Hunter** category appears in Meteor's ClickGUI.

---

## 4. First run: get the dashboard open

Open the Meteor ClickGUI (default `RightShift`), find the **Logvex Hunter** category, and click the
**Logvex Hunter** tab. Or type a command:

```
.hunter gui
```

The dashboard is the control centre. Everything else hangs off it.

> Meteor and this addon only act on the server you are connected to. Nothing happens in the main
> menu; most panels show "not connected" until you are in a world.

---

## 5. The dashboard

The dashboard tab shows, live:

- **Hunter state** — running / stopped / emergency stop, active profile.
- **Current target** — name, category, priority, distance.
- **Your coordinates** and the target's last known position.
- **Health and armour** for you and the current target.
- **Equipment status** — armour pieces, durability, totems, food.
- **Active modules** — a list with a settings button per module.
- **Session statistics** — kills, deaths, encounters, session duration.
- **Connected instances** — registered clients and their status.
- **Recent combat events** — a rolling table.

Controls on the dashboard:

| Control | What it does |
| --- | --- |
| **Start** | Starts a session: enables the tracker/coordinator if `auto-enable-modules` is on. |
| **Stop** | Ends the session cleanly (saves if `save-on-stop`). |
| **Emergency stop** | Immediately disables coordination and marks the session stopped. |
| **Clear emergency stop** | Re-arms after an emergency stop. |
| **Module toggles** | Enable/disable any hunter module directly. |
| **Navigation** | Buttons to Target Manager, Combat, Equipment, Stasis, Messages, Instances, Companion, Statistics, Profiles. |

Dashboard module settings (Meteor module `hunter-dashboard`):

| Setting | Meaning |
| --- | --- |
| `auto-enable-modules` | Enable tracker + coordinator when the hunter starts. |
| `announce-start-stop` | Chat message on start/stop. |
| `track-deaths` | Record your deaths in the statistics. |
| `death-health-threshold` | Health at or below which a death is assumed. |
| `save-on-stop` | Persist everything when the hunter stops. |
| `autosave-interval` | Seconds between automatic saves (0 = off). |

---

## 6. Target Manager

Open it from the dashboard, with `.target gui`, or by editing the `player-tracker` module.

### Categories

| Category | Key | Used for |
| --- | --- | --- |
| Priority | `priority` | Primary targets, always considered first. |
| Bot | `bot` | Known bots. |
| Opponent | `opponent` | Human opponents. |
| Temporary | `temporary` | Auto-added, time-limited entries. |
| Friend | `friend` | Protected — never attacked. |
| Ignore | `ignore` | Protected — never attacked or tracked. |

### Adding and removing targets

```
.target add Notch priority
.target add SomeBot bot
.target remove Notch
.target list                 # lists the priority category
.target list bot
.target focus Notch          # make it the current target (must be visible)
.target current              # show the current target
.target clear                # clear the current target
```

### Selection and filters

The `player-tracker` module controls detection:

| Setting | Meaning |
| --- | --- |
| `range` | Maximum distance at which a player is considered. |
| `scan-interval` | Ticks between scans (higher = less per-tick work). |
| `close-range` | Distance counted as "close" for entered-range alerts. |
| `sort-mode` | How candidates are ordered when picking a target. |
| `auto-select` | Pick a target automatically from the filters. |
| `max-candidates` | Cap on candidates evaluated per scan. |
| `switch-cooldown` | Minimum time between automatic target switches. |
| `protect-friends` | Never target the friend list. |
| `protect-ignored` | Never target the ignore list. |
| `ignore-naked` | Skip players below `naked-armor-threshold`. |
| `naked-armor-threshold` | Armour points that count as "naked". |
| `require-weapon` | Only consider players holding a weapon. |
| `ignore-invisible` | Skip invisible players. |
| `ignore-creative` | Skip creative-mode players. |
| `only-tracked` | Only ever target players already on a list. |
| `auto-add-temporary` | Add newly detected players as `temporary`. |

Each target entry keeps its last-known position, dimension, encounter count, kills and deaths, so
you can find a player again after they log out.

---

## 7. Combat coordination

The `combat-coordinator` module keeps Meteor's combat modules in step with the current target. It
turns them on while a valid target exists and off when it is gone, and refuses to fight friends or
ignored players.

| Setting | Meaning |
| --- | --- |
| `manage-kill-aura` | Enable Meteor's KillAura while a target is present. |
| `manage-auto-weapon` | Enable Meteor's AutoWeapon while a target is present. |
| `manage-auto-totem` | Keep Meteor's AutoTotem enabled while running. |
| `manage-auto-armor` | Keep Meteor's AutoArmor enabled while running. |
| `manage-auto-eat` | Keep Meteor's AutoEat enabled while running. |
| `avoid-conflicts` | Disable conflicting modules (e.g. CrystalAura / AnchorAura) while coordinating. |
| `disable-on-death` | Stop coordinating when you die. |
| `only-with-target` | Only touch Meteor modules when a target exists. |

Configure the Meteor modules themselves (reach, rotation, etc.) in their own Meteor screens — this
addon only toggles them and coordinates the target.

The Combat screen from the dashboard shows each managed module's live state and lets you toggle
coordination without leaving the GUI.

---

## 8. Equipment manager

The `equipment-manager` module watches armour, durability, totems, food and weapons.

| Setting | Meaning |
| --- | --- |
| `warn-low-durability` | Warn when a piece of gear is nearly broken. |
| `low-durability-percent` | Durability percentage considered low. |
| `min-armor-pieces` | Warn below this many equipped armour pieces. |
| `min-totems` | Warn below this many totems carried. |
| `min-food` | Warn below this many food items carried. |
| `warn-missing-weapon` | Warn when no weapon is carried. |
| `warn-full-inventory` | Warn when the inventory has no free slot. |
| `announce-warnings` | Send warnings to chat as they appear. |
| `announce-cooldown` | Seconds between identical warnings. |

The Equipment screen shows current armour, per-piece durability, totem and food counts, and any
active warnings. Warnings respect a cooldown so they do not spam chat.

---

## 9. Messages and placeholders

The `notifications` module sends chat messages for hunter events. Messages are **local by default**;
sending them to the server is opt-in and off unless you enable it.

### Events

| Event key | Fires when |
| --- | --- |
| `target-detected` | A new player is detected. |
| `target-disappeared` | A target leaves range. |
| `target-reappeared` | A target comes back. |
| `target-entered-range` | A player moves close. |
| `target-eliminated` | A target dies. |
| `target-low-health` | A target drops below a health threshold. |
| `stasis-danger` | Defensive readiness hits DANGER/CRITICAL. |
| `stasis-recovered` | Readiness returns to SAFE. |
| `connection-lost` | The connection drops. |

Each event can be enabled/disabled and has its own message template and cooldown.

### Placeholders

Any template may use these tokens; unknown tokens are left as-is:

`{player}` `{username}` `{uuid}` `{distance}` `{health}` `{armor}` `{weapon}` `{server}`
`{coordinates}` `{category}` `{priority}` `{time}`

Example template:

```
{player} killed by logvex because you suck. ({weapon}, {distance}m, at {coordinates})
```

### Profiles

Message profiles let you keep several sets of templates (for example "polite" and "trash talk")
and switch between them. The Messages screen supports:

- choosing the active profile,
- enabling/disabling individual event messages,
- editing templates,
- a **preview** that fills placeholders with sample data,
- per-event cooldowns.

The `notifications` module also has toggles: `notify-detect`, `notify-disappear`, `notify-reappear`,
`notify-entered-range`, and friends/ignored players are excluded by the tracker's protection
settings.

---

## 10. Defensive stasis

The `defensive-stasis` module computes a readiness level from health, totems, food, armour and
durability. It is observation-only: it never attacks.

| Level | Meaning |
| --- | --- |
| SAFE | All thresholds satisfied. |
| CAUTION | Something is low (e.g. food). |
| DANGER | Health or supplies critically low. |
| CRITICAL | Imminent risk. |

| Setting | Meaning |
| --- | --- |
| `danger-health` | Health at or below which stasis is DANGER. |
| `critical-health` | Health at or below which stasis is CRITICAL. |
| `min-totems` | Totems below which stasis is not SAFE. |
| `min-food` | Food below which stasis is CAUTION. |

The Stasis screen shows the current level, what is driving it, and the connection-loss state. You
can define several defensive profiles and switch between them.

---

## 11. Statistics

The `hunter-statistics` module tracks:

- total kills and deaths,
- combat sessions and session duration,
- player encounters,
- equipment usage,
- module activation history,
- combat performance (K/D, per-session summaries).

| Setting | Meaning |
| --- | --- |
| `track-playtime` | Add to the total playtime counter every minute. |
| `export-on-stop` | Write a CSV and JSON report when the module is disabled. |
| `history-size` | How many sessions to keep in the history. |

View and export:

```
.hstats show        # summary
.hstats sessions    # session history
.hstats events      # recent events
.hstats export      # write JSON + CSV to exports/
.hstats reset       # clear the counters
.hstats gui         # open the Statistics screen
```

Exports land in `config/logvex-hunter/exports/`. The Statistics screen shows the same data with
simple graphs.

---

## 12. Multi-instance management

The `instance-manager` module lets one client register others and poll their read-only statistics
over HTTP. **Each client's world state is private** — one instance only ever learns what another
explicitly exposes, over an authenticated endpoint.

| Setting | Meaning |
| --- | --- |
| `poll-interval` | Seconds between status polls of every instance. |
| `timeout` | HTTP timeout in milliseconds. |
| `announce-changes` | Report instance status changes in chat. |
| `expose-status` | Serve this instance's own status endpoint. |
| `expose-port` | Port of this instance's status endpoint. |

Registered instances are stored in `instances.json`. The Instances screen shows each one's
connection state, health, and a **per-instance emergency stop**. Emergency stops are isolated: one
instance stopping does not stop another.

---

## 12b. In-game swarm (control many clients from one)

The `swarm` module is the in-game counterpart to Meteor's own Swarm: one client is the **host** and
drives the others, with no external app involved.

| Setting | Meaning |
| --- | --- |
| `mode` | `HOST` (drives the fleet) or `HUNTER` (fully controlled by the host). |
| `auto-start` | Start the link when the client joins a world. |
| `announce` | Report joins, leaves and results in chat. |
| `allow-combat-broadcast` | Let a broadcast change combat modules on the whole fleet. Off by default. |
| `Host → port` | Port the host listens on (default `6969`). |
| `Host → token` | Shared secret hunters must present. Empty accepts anyone on the port. |
| `Host → allow-remote` | Accept hunters from other machines. Off keeps it on loopback. |
| `Hunter → host` / `Hunter → port` | Where the hunter connects. |
| `Hunter → token` | The token the host expects. |

Quick start:

1. Host: dashboard → **Swarm** → **Become host** (or `.swarm host`).
2. Hunters: `.swarm join <host-ip> <port>` (or the Swarm screen → **Become hunter**).
3. Host: `.swarm connections` to see who joined; type a command and press **Broadcast**, or use
   `.swarm send <hunter> <command>` for one hunter.

A hunter applies exactly the command the host sends, through the same control layer as the local
player, so `.swarm send 1 target add Griefer01` adds a target on hunter 1. Only read-only, cosmetic
and non-combat tuning commands may be broadcast; lifecycle and combat changes must be sent to one
hunter at a time, or the host must opt in to `allow-combat-broadcast`. A single-hunter send that
would arm combat only warns. `emergency-stop` always broadcasts, and the host sends it to the fleet
on its own emergency stop.

---

## 13. The companion API

The `companion` module serves a small authenticated HTTP endpoint so the Fleet Manager (or the
bundled web page) can read state and send commands. It runs on **loopback by default**.

```
.hunter companion start
.hunter companion status
.hunter companion token        # print the current token
.hunter companion regenerate   # rotate the token
.hunter companion port 8720    # change the port
.hunter companion stop
```

| Setting | Meaning |
| --- | --- |
| `port` | TCP port (default **8720**). |
| `allow-remote` | Accept connections from other machines (off by default). |
| `token` | Bearer token; generated and printed when empty. |

### Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | public | version, connection and running state |
| GET | `/api/v1/snapshot` | token | bot view, players, targets, modules, stats in one call |
| GET | `/api/v1/players` | token | visible players |
| GET | `/api/v1/targets` | token | target lists |
| GET | `/api/v1/modules` | token | module states |
| GET | `/api/v1/stats` | token | statistics counters |
| GET | `/api/v1/events?since=&limit=` | token | recent combat events |
| GET | `/api/v1/chat?since=&limit=` | token | alias of `/events` |
| GET | `/api/v1/tasks` | token | current session and target as tasks |
| POST | `/api/v1/command` | token | run a command (`{"command":"..."}`) |
| POST | `/api/v1/notify` | token | local notification (`{"message":"..."}`) |
| POST | `/api/v1/bot/{status,pause,resume,stop}` | token | bot lifecycle (also `{"action":"..."}`) |

Authentication is `Authorization: Bearer <token>` **or** `?token=<token>` (the query form exists
because browsers' `EventSource` cannot set headers). If the configured token is empty, every
`/api/v1/*` request is rejected with 401.

### Trying it by hand

```bash
curl http://127.0.0.1:8720/health

curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8720/api/v1/snapshot

curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"command":"target add Griefer priority"}' \
  http://127.0.0.1:8720/api/v1/command

curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"command":"bot pause"}' \
  http://127.0.0.1:8720/api/v1/bot/pause
```

### Command vocabulary

The `/api/v1/command` endpoint accepts the same vocabulary as the in-game helper:

```
status | start | stop | emergency-stop (estop, panic) | clear-stop | save
target add <name> [category] | target remove <name> | target list [category] | target focus <name>
module <name> [on|off] | toggle <name>
focus <name> | clear-target
bot <status|pause|resume|stop>
```

Only enable `allow-remote` on a trusted network — with it on, anything that can reach the port and
holds the token can read state and issue commands.

---

## 14. Fleet Manager: install and run

```bash
cd fleet-manager
npm install

# Development (Vite renderer + Electron)
npm run dev

# Production build + run
npm run build
npm start

# Tests, typecheck, screenshots
npm test
npm run typecheck
npm run screenshots      # writes docs/screenshots/*.png

# Package a desktop installer
npm run package:linux    # AppImage + .deb
npm run package:win      # NSIS installer
```

The app stores its SQLite database at `<userData>/fleet.sqlite` (Electron's `userData` directory,
e.g. `~/.config/logvex-fleet-manager/` on Linux).

Each bot runs in its own isolated Node worker process, so a crash or hang in one never takes the
app down.

---

## 15. Fleet Manager: pages and workflow

The app starts in **Beginner mode** with a small, focused navigation. Switch to **Advanced mode**
(top-right, or in Settings) to reveal the deployment builder, queue editor and technical settings —
the same features, just shown when you want them.

| Section | What it does |
| --- | --- |
| **Dashboard** | Guided setup checklist, one-click *Start my bots*, live bot state and recent activity. |
| **Main Features** | Tabs for **Hunter** (LogVex Hunter link), **Targets** (shared target list), **Gear** (equipment profiles), **Stasis** (defensive locations) and **Servers** (connection profiles). |
| **Tasks** | Start and manage bots. Beginner mode is pick-and-press-start; Advanced mode adds the deployment builder, queue, validation preview and live monitor. |
| **Accounts** | Minecraft accounts, credentials (stored in the credential vault), and status. |
| **Activity** | The event stream, notifications, statistics and per-instance logs. |
| **Settings** | App settings, including the Hunter addon URL and token, plus an Advanced section. |
| **Help** | A short guide, glossary and FAQ. |

Typical workflow (everything below is also reachable from the Dashboard checklist):

1. **Dashboard → Quick start** — add a server and an account in one step (or use **Main Features →
   Servers** and **Accounts** separately).
2. **Dashboard → Start my bots** — pick the accounts to bring online and press start.
3. **Main Features** — adjust gear, stasis or target settings as needed.
4. **Activity** — watch the fleet and react to events.

### Roles

| Role | Purpose |
| --- | --- |
| **GEARER** | Manages armour, weapons, tools and supplies; sorts inventory to the profile (never drops items) and reports EQUIPMENT_READY / EQUIPMENT_WARNING. |
| **STASIS** | Monitors a saved stasis location and its readiness; notifies on state change; optional confirmation before state-changing actions. |
| **HUNTER** | Observes targets, and — **only** with `combat-testing-enabled` plus `explicit-combat-authorisation` and a matching allowlist — engages them in a private test environment. |

The HUNTER role is deliberately gated: with the two toggles off (the default) it observes only. The
one-click *Start my bots* flow never arms combat for you — it requires an explicit
"Authorise combat testing" tick, and refuses to start otherwise.

### The app's own API

The Fleet Manager serves a local HTTP API (default `127.0.0.1:8787`) and a WebSocket event stream
at `/events`:

```
GET  /health
GET  /api/v1/status | instances | accounts | servers | targets | events
     | deployments | groups | roles | settings | stasis | equipment
POST /api/v1/targets | events | command | notify | targets/sync
WS   /events
```

---

## 16. Connecting the Fleet Manager to the addon

In the addon:

```
.hunter companion start
.hunter companion token     # copy this token
```

In the Fleet Manager:

1. Open the **Settings** page.
2. Set **Hunter base URL** to `http://127.0.0.1:8720` (the addon's default port).
3. Paste the token.
4. Open **Main Features → Hunter** — the client should show as connected with its version and last
   sync. (The Dashboard checklist also links straight there.)

The Fleet Manager calls `/health`, `/api/v1/snapshot`, `/api/v1/modules`, `/api/v1/players`,
`/api/v1/command` and `/api/v1/notify`. A client that is offline, misconfigured or not running
simply shows as disconnected; nothing throws into the UI.

> If you changed the addon's port with `.hunter companion port <n>`, use the same port in the URL.

---

## 17. Configuration files

The addon stores everything as JSON under `.minecraft/config/logvex-hunter/`:

| File | Contents |
| --- | --- |
| `config.json` | master switch, emergency stop, active profile, instance identity, companion settings, profiles |
| `targets.json` | the target lists |
| `messages.json` | message profiles and templates |
| `statistics.json` | counters, sessions and recent events |
| `instances.json` | the registered instances |

Directories: `profiles/` (named profiles), `exports/` (statistics exports), `backups/`.

A corrupt file is moved to `backups/` and reset to defaults instead of crashing; the reason is
reported in chat on the next launch.

Ready-to-use examples for the four main files are in [`examples/`](examples/). Copy one over the
matching file under `config/logvex-hunter/` to start from it.

---

## 18. Command reference

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

Categories for `.target`: `priority`, `bot`, `opponent`, `temporary`, `friend`, `ignore`.

---

## 19. Remote control from the Fleet Manager

Every control action is available over the companion API, so the Fleet Manager can change settings,
switch profiles and toggle HUD elements without touching the game. The HTTP routes and the chat
commands both run through the same Minecraft-free control layer
(`com.logvex.hunter.core.control`), so the two behave identically.

Read and change settings:

```
GET  /api/v1/modules/player-tracker         # module detail, including every setting
POST /api/v1/settings                        # {"module":"player-tracker","setting":"range","value":"96"}
```

Switch profiles:

```
GET  /api/v1/profiles                        # list, with the active one flagged
POST /api/v1/profiles/pvp                    # switch the active profile
```

Toggle HUD elements:

```
GET  /api/v1/hud                             # list every element and whether it is shown
POST /api/v1/hud/logvex-target               # toggle one
```

Drive the hunter lifecycle:

```
POST /api/v1/hunter/start
POST /api/v1/hunter/pause
POST /api/v1/hunter/resume
POST /api/v1/hunter/emergency-stop
POST /api/v1/hunter/clear-stop
POST /api/v1/hunter/save
POST /api/v1/hunter/status
```

In-game, the Control screen (`.hunter control`) offers the same settings editor, profile switcher
and HUD toggles as a GUI.

---

## 20. Module reference

All modules live under the **Logvex Hunter** Meteor category.

| Module | Purpose |
| --- | --- |
| `hunter-dashboard` | Master switch and session driver. |
| `player-tracker` | Detects nearby players and selects a target. |
| `combat-coordinator` | Coordinates Meteor's combat modules around the target. |
| `equipment-manager` | Monitors armour, durability, totems, food and weapons. |
| `defensive-stasis` | Monitors defensive readiness and danger thresholds. |
| `notifications` | Sends configurable chat messages for hunter events. |
| `instance-manager` | Polls and controls other registered client instances. |
| `swarm` | Host/Hunter control of other clients, in game (one mod, no server). |
| `companion` | Serves the local HTTP endpoint for the Fleet Manager. |
| `hunter-statistics` | Tracks session statistics and exports reports. |

HUD elements (Meteor's Info HUD): target info, equipment, stasis, statistics, swarm and hunter
status. Enable the ones you want from Meteor's HUD editor.

---

## 21. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| The Fleet Manager shows the Hunter as disconnected | The companion module is not started, the port differs, or the token is wrong. Run `.hunter companion start` and `.hunter companion token`, and check the URL/port on the Settings page. |
| `/api/v1/*` returns 401 | The token is empty or does not match. The addon rejects all API calls when its configured token is blank. |
| `curl` to the companion port is refused | The endpoint only listens while the companion module is running, and binds to loopback unless `allow-remote` is on. |
| A module does nothing | Most modules only act while connected to a world; check the dashboard's state line. |
| Targets are ignored unexpectedly | Check `protect-friends`, `protect-ignored`, `ignore-naked`, `require-weapon`, `only-tracked` and the `ignore`/`friend` lists. |
| Chat warnings spam | Raise the relevant cooldown, or disable the specific event in the Messages screen. |
| A config file looks broken | It is reset to defaults and moved to `backups/`; the reason is printed in chat on next launch. |
| Hunters cannot join the host | The host and hunter tokens differ, the port differs, or `allow-remote` is off and the hunter is on another machine. Set the same token on both and enable `allow-remote` on the host. |
| A broadcast is refused | Only read-only commands broadcast by default. Send it to one hunter with `.swarm send`, or enable `allow-combat-broadcast` on the host. |
| Stats export is missing | Run `.hstats export`; files are written to `config/logvex-hunter/exports/`. |
| `./gradlew` says JAVA_HOME is invalid | You exported the literal placeholder. Point `JAVA_HOME` at a real JDK 21+ directory, e.g. `export JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(which javac)")")")"`, or install one. |
| `./gradlew` says a dependency needs JVM 25 / "requires at least JVM runtime version 25" | You are building with a JDK older than 25. Fabric Loom 1.18 needs a Java 25 runtime; install a JDK 25 and point `JAVA_HOME` at it. The mod still runs on Java 21. |

---

MIT — see [LICENSE](LICENSE).
