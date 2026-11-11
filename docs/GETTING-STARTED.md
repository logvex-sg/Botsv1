# Getting started with Logvex

This is the short path: pick what you want to do, follow the numbered steps, and you are running.
Every command and button below is real — they are taken from the source, not invented. When you want
the full reference, [USAGE.md](../USAGE.md) has every setting, endpoint and command.

- [The 60-second version](#the-60-second-version)
- [What the three pieces are](#what-the-three-pieces-are)
- [Path A — just the addon, in game](#path-a--just-the-addon-in-game)
- [Path B — Fleet Manager with one bot](#path-b--fleet-manager-with-one-bot)
- [Path C — HIVE MODE, many bots as one](#path-c--hive-mode-many-bots-as-one)
- [Everyday commands](#everyday-commands)
- [Where your settings live](#where-your-settings-live)
- [When something is wrong](#when-something-is-wrong)

---

## The 60-second version

1. Install **Fabric Loader** for Minecraft **1.21.11** and put **Meteor Client** `1.21.11-SNAPSHOT`
   in your `mods` folder.
2. Drop **`logvex-hunter-v6.0.0.jar`** in the same `mods` folder. Launch the game.
3. Press **Right Shift** (Meteor's default) to open the ClickGUI, then open the **Logvex Hunter**
   category. That is the dashboard.

That is the whole addon, working. Everything else on this page is optional: the Fleet Manager is only
needed when you want *one machine to drive several Minecraft clients*.

Download links are on the [Releases](https://github.com/logvex-sg/Botsv1/releases) page or the
landing page <https://logvex-sg.github.io/Botsv1/>.

---

## What the three pieces are

| Piece | What it is | Do you need it? |
| --- | --- | --- |
| **LogVex Hunter** | A Meteor addon. Tracks players, records statistics, coordinates Meteor's combat modules, and can control *other* Hunter clients from in-game. | Yes, if you want any of this. |
| **Logvex Worker** | A second Fabric mod. It dials **out** to a Fleet Manager and answers tasks (status, inventory, regear, command, chat, efly). | Only for Path B and C. |
| **Logvex Fleet Manager** | A desktop app (Windows / Linux). It is the **host**: it sends tasks to Worker clients and reads back confirmed results. | Only for Path B and C. |

Two things worth knowing before you start:

- **The Fleet Manager never logs into Minecraft.** It holds no account and needs no inbound port on a
  bot machine. Each bot is a real Minecraft client running the Worker mod, which connects *to* the host.
- **Nothing here attacks on its own.** The Hunter addon monitors and coordinates; it does not add
  unattended combat automation. HIVE MODE coordinates movement and tasks, and a broadcast that would
  arm combat on the whole fleet is refused unless you explicitly opt in.

---

## Path A — just the addon, in game

You want target tracking, statistics and combat coordination on the client you are playing.

1. **Install** as in the 60-second version above.
2. **Open the dashboard.** ClickGUI (Right Shift) → **Logvex Hunter**, or type `.hunter gui` in chat.
3. **Turn the core modules on.** In the dashboard, enable:
   - `player-tracker` — picks and tracks the current target
   - `hunter-dashboard` — the live status tab
   - `equipment-manager` — armour, totems, food and durability warnings

   The full set is `player-tracker`, `hunter-dashboard`, `combat-coordinator`, `equipment-manager`,
   `notifications`, `defensive-stasis`, `hunter-statistics`, `instance-manager`, `companion` and
   `swarm`.
4. **Add friends so you never target them.** Either the Target Manager's friend list in the GUI, or:
   ```
   .target add <name> friend
   .target list
   ```
   The category is the **second** argument; it defaults to `priority` if you leave it off. The
   categories are `priority`, `bot`, `opponent`, `ignore`, `friend` and `temporary`.
5. **Watch it work.** The dashboard shows the current target, distance, health, armour, module state
   and recent events. `.hunter status` prints the same to chat.

**Let Meteor do the fighting.** Hunter does not reimplement KillAura. It coordinates the ones you
already have, so turn on **Meteor's own** `KillAura` / `AutoTotem` / `AutoArmor` and let Hunter manage
the target and avoid conflicts.

**Check your statistics:**
```
.hstats show        # totals, session, performance
.hstats sessions    # per-session history
.hstats export      # writes JSON + CSV
```

---

## Path B — Fleet Manager with one bot

You want a desktop app that drives a Minecraft client. Start with one bot; add more later.

### 1. Start the host (the desktop app)

1. Install the Fleet Manager — `...-windows-x64-setup.exe` on Windows, or the `.deb` / `.AppImage`
   on Linux ([details](RELEASE.md)).
2. Launch it. On first run it asks **Host** or **Worker** — choose **Host**.
3. Go to **Dashboard → Generate pairing code**. Copy the short code (looks like `ABCD2345`). It is
   single-use and expires, so generate a fresh one for each new bot.

### 2. Prepare the bot client (the Minecraft side)

1. On the machine that will be the bot, install Fabric 1.21.11 + Meteor + **both** jars:
   `logvex-hunter-v6.0.0.jar` and `logvex-worker-v6.0.0.jar`.
2. Launch the game once so the Worker mod writes its config, then close it.
3. Open `config/logvex-worker.json` and point it at the host:
   ```json
   {
     "host": { "address": "192.168.1.50", "port": 8721, "pairingCode": "ABCD2345" }
   }
   ```
   `8721` is the default worker-server port. Use the host machine's **LAN** address — a bot on
   another machine cannot reach `127.0.0.1`.
4. **Let the bot reach the host.** The host's worker server binds to **loopback only** by default,
   so nothing outside the host machine can connect until you allow it. In the app, open
   **Settings → Worker server** and set the bind host to `0.0.0.0` (or the host's LAN address), then
   restart the server. Keep the bearer token secret: that port is unauthenticated only for `/health`.
5. Launch the game again. The worker pairs, stores the long-lived token, and reuses it from then on —
   you only paste a pairing code once.

### 3. Confirm it is connected

- In the app: **Workers** shows the bot, its state, and whether it is paused.
- In the bot's game: `.worker status` and `.worker events` print the same thing from the client's side.

### 4. Send it something to do

1. **Tasks** → pick a task kind (status, inventory, regear, container, shulker, restock, efly, …).
2. Fill in the form (it is generated from the task's own schema) and **Dispatch**.
3. Watch the result in **Tasks** (history) and **Consoles** (what the client itself logged).

Or from the API / a script:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  -X POST http://127.0.0.1:8721/api/v1/workers/<workerId>/task \
  -d '{"kind":"status","params":{}}'
```

### 5. Set the permissions you actually want

A worker starts with the safe defaults **off**: `allowCommands`, `allowChat`, `allowDigging`,
`allowCrafting`, `allowDisposal` and `allowPortalRemoval` are all disabled; container moves, shulker
pack/unpack and restock are on. Turn on only what this bot needs, in its `config/logvex-worker.json`
(or the Worker mod's settings screen). **The host can narrow these but never widen them** — the
runtime applies the intersection.

---

## Path C — HIVE MODE, many bots as one

You have several Workers connected (Path B, repeated) and want them to act as a group.

1. Open the **HIVE MODE** page.
2. Press **Start**.
3. Give the swarm a **role** each (or let the coordinator assign them): `COMMANDER`, `SCOUT`,
   `ESCORT`, `MINER`, `LOGISTICS`, `STORAGE`, `GUARD`, `SUPPORT`, `BUILDER`, `GENERALIST`.
4. Type a plain instruction and send it. The parser matches fixed phrasings by substring, so use
   these shapes:

   | You type | What happens |
   | --- | --- |
   | `follow me` | everyone adopts the follow formation |
   | `circle around me` | circle formation |
   | `spread out` | scatter formation |
   | `protect me` | defensive escort ring, GUARD role |
   | `scout north` | scouts head out north (`south` / `east` / `west` too) |
   | `scout the northern area` | scouts to a named area |
   | `send two workers to mine` | assigns 2 workers to the role named (verbs: send, assign, have, give, dispatch, task) |
   | `assign four to storage` | assigns 4 to STORAGE |
   | `organise storage` | logistics workers sort the storage |
   | `guard the area` | GUARD monitors the area |
   | `regroup` | everyone returns to formation |
   | `recall everyone` | everyone comes back to the commander |
   | `stop all tasks` | halts the swarm but keeps the hive |
   | `status` | report only, no action |

   Anything it does not recognise is **refused with the list of what it can do** — it never guesses.
   A compound sentence like "circle around me and scout north" is reduced to its first clause, so
   send the second order separately.

5. Watch the **live canvas map** (positions, formation targets, explored sectors, shared sightings),
   the **objective queue**, the **shared intelligence** and the **command history**.
6. **Emergency stop** disables the hive and stops all tasks in one click.

Every hive order travels the *same task path* a hand-sent task does, so it is validated and reported
exactly the same way — there is no second, quieter control channel.

---

## Everyday commands

Type these in Minecraft chat. The command names are exact; aliases are in brackets.

### Hunter
```
.hunter gui                     open the dashboard
.hunter status                  current state and target
.hunter start / stop            run / stop the addon
.hunter pause / resume          suspend and resume
.hunter emergency-stop          hard stop everything now
.hunter clear-stop              undo an emergency stop
.hunter modules                 list modules and their state
.hunter toggle <module>         turn one module on or off
.hunter profile use <name>      switch configuration profile
.hunter save                    write the config to disk
.hunter control                 open the manual control screen
```

### Targets
```
.target list [category]         show a list (default: priority)
.target add <name> [category]   categories: priority, bot, opponent, ignore, friend, temporary
.target remove <name> [category]
.target current                 the current target
.target focus <name>            lock onto one player
.target clear                   clear the temporary list
```

### Statistics
```
.hstats show                    totals, session and performance
.hstats sessions                per-session history
.hstats events                  recent combat events
.hstats export                  write JSON + CSV
.hstats reset                   clear the statistics
```

### Worker (on a bot client)
```
.worker status                  connection and task state
.worker inventory               carried items
.worker count <item>            count one item
.worker equipment               armour, food, totems, durability
.worker container <x> <y> <z>   read a container
.worker restock <item> [limit]  pull items from an open container
.worker shulkers                list shulker boxes
.worker pack <query>            pack matching items into shulkers
.worker position                coordinates
.worker connect / disconnect / reconnect
.worker pause / resume
```

### In-game swarm (Hunter controlling other Hunters, no desktop app)
```
.swarm host                          become the host of the swarm
.swarm join <ip> <port>              join a host as a hunter
.swarm status                        connections and mode
.swarm connections                   list connected hunters
.swarm send <hunter> <command>       run a Hunter command on one hunter
.swarm broadcast <command>           read-only command to all hunters
.swarm kick <hunter>                 drop a hunter
.swarm stop                          leave the swarm
.swarm port <port>                   change the host port
.swarm token <token>                 set the shared swarm token
```

### The bot runtime (the `bot/` worker, run from a terminal)
```
npx logvex-bot run              connect and serve tasks
npx logvex-bot config           print the effective configuration
npx logvex-bot plan "text"      interpret an instruction offline, no connection
npx logvex-bot commands         list the server commands this worker may send
```

---

## Where your settings live

| What | Where |
| --- | --- |
| Hunter addon settings | `config/logvex-hunter/` in your Minecraft folder (plus profiles) |
| Worker mod settings | `config/logvex-worker.json` in the bot's Minecraft folder |
| Fleet Manager data | the app's user-data directory — SQLite database (roster, groups, task history, storage, hive state) |
| Bot runtime state | its own `stateDir`, default the current directory |

The Fleet Manager's live connection state is in memory; everything you would be annoyed to lose is in
the database. Corrupt or hand-edited JSON is handled: a bad config falls back to defaults and is
reported rather than crashing the client.

---

## When something is wrong

| Symptom | What to check |
| --- | --- |
| No **Logvex Hunter** category in the ClickGUI | The jar is in the right `mods` folder, Fabric is 1.21.11, and Meteor is the matching `1.21.11-SNAPSHOT`. Check the log for the addon's startup line. |
| `.hunter` is not a command | Same as above — the addon did not load. |
| Bot never appears on the Dashboard | The bot's `host`/`port` point at the host machine's LAN address, the pairing code is fresh, and the host's port is not blocked by a firewall. |
| Pairing code rejected | Codes are single-use and expire — generate a new one. |
| A task is refused | Check the worker's permissions in `config/logvex-worker.json`. Safe defaults disable commands, chat, digging and portal removal. |
| A hive instruction is refused | The parser did not recognise the phrasing. It replies with the list of instructions it does support — rephrase using one of those. |
| Windows warns about the installer | Expected: the installer is self-signed. Choose **More info → Run anyway**, and verify `SHA256SUMS.txt`. See [SIGNING.md](SIGNING.md). |
| AppImage will not start | Add `--appimage-extract-and-run`. |

Still stuck? `.hunter status`, `.worker events` and the **Consoles** page all print the real state
from the client's side — start there rather than guessing.

---

## Where to read more

| Document | What is in it |
| --- | --- |
| [USAGE.md](../USAGE.md) | The full reference: every setting, module, command, endpoint and config key. |
| [docs/RELEASE.md](RELEASE.md) | Which file to download for your OS and exactly what to do with it. |
| [docs/SIGNING.md](SIGNING.md) | What the code signature proves, and how to verify it. |
| [docs/PROTOCOL.md](PROTOCOL.md) | The worker ↔ host wire protocol. |
| [docs/ARCHITECTURE.md](ARCHITECTURE.md) | How the pieces fit together internally. |
| [host/README.md](../host/README.md) | Every Fleet Manager page and its REST API. |
| [worker-mod/README.md](../worker-mod/README.md) | The Worker mod in detail. |
