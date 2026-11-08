# Changelog

All notable changes to **LogVex Hunter** (the Meteor Client addon) are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/logvex-sg/Botsv1/releases/tag/v1.0.0
