# Logvex v6.0.0 — release guide

This page explains what is in a Logvex release and, for each file, exactly what to do with it.

## What is in a release

A Logvex release contains two kinds of thing:

| Kind | Files | Platform |
| --- | --- | --- |
| **Minecraft mods** (Java, run inside the game) | `logvex-hunter-v6.0.0.jar`, `logvex-worker-v6.0.0.jar` | Any OS — the jars are platform-independent |
| **Fleet Manager** (Electron desktop app) | `...-windows-x64-setup.exe`, `...-linux-x86_64.AppImage`, `...-linux-x86_64.deb` | Windows, Debian/Ubuntu Linux |

There is one release per version. The Windows and Linux files are the *same application* built for
two platforms; you download only the one for your OS.

## Pick your files

| You want to… | Download |
| --- | --- |
| Play with the Hunter addon in Minecraft | `logvex-hunter-v6.0.0.jar` (Windows, macOS, Linux — same file) |
| Run bot clients the Fleet Manager can drive | `logvex-worker-v6.0.0.jar` (same file on every OS) |
| Run the Fleet Manager on **Windows** | `Logvex-Fleet-Manager-v6.0.0-windows-x64-setup.exe` |
| Run the Fleet Manager on **Debian/Ubuntu** (installed) | `Logvex-Fleet-Manager-v6.0.0-linux-x86_64.deb` |
| Run the Fleet Manager on **any Linux** (no install) | `Logvex-Fleet-Manager-v6.0.0-linux-x86_64.AppImage` |
| Verify your download | `SHA256SUMS.txt` |

The two `.jar` files are the only things a player needs. The desktop app is optional — it is the
Fleet Manager host that coordinates several bot clients.

---

## Windows

### Fleet Manager

1. Download `Logvex-Fleet-Manager-v6.0.0-windows-x64-setup.exe`.
2. Run it. It installs for the current user (no admin prompt) and adds a Start Menu entry.
3. Launch **Logvex Fleet Manager**. On first run it asks whether this machine is the **Host**;
   choose Host.

The installer is signed with the project's self-signed certificate, so Windows SmartScreen may warn
the first time. Choose **More info → Run anyway**. See [`SIGNING.md`](SIGNING.md) for what the
signature does and does not prove, and how to verify it.

### Minecraft mods

1. Install Fabric Loader for Minecraft 1.21.11.
2. Put [Meteor Client](https://meteorclient.com/) `1.21.11-SNAPSHOT` in `%APPDATA%\.minecraft\mods`.
3. Copy `logvex-hunter-v6.0.0.jar` into the same `mods` folder.
4. To drive this client from the Fleet Manager, also copy `logvex-worker-v6.0.0.jar` into `mods`.
5. Launch the game. The addon registers a **Logvex Hunter** ClickGUI category.

---

## Debian / Ubuntu Linux

### Fleet Manager — `.deb` (recommended)

```bash
sudo apt install ./Logvex-Fleet-Manager-v6.0.0-linux-x86_64.deb
logvex-fleet-manager
```

`apt` pulls in the dependencies automatically. To remove it later: `sudo apt remove logvex-fleet-manager`.

### Fleet Manager — AppImage (any Linux, no install)

```bash
chmod +x Logvex-Fleet-Manager-v6.0.0-linux-x86_64.AppImage
./Logvex-Fleet-Manager-v6.0.0-linux-x86_64.AppImage
```

If the AppImage refuses to start because of FUSE, run it with
`./Logvex-Fleet-Manager-v6.0.0-linux-x86_64.AppImage --appimage-extract-and-run`.

### Minecraft mods

1. Install Fabric Loader for Minecraft 1.21.11.
2. Put Meteor Client `1.21.11-SNAPSHOT` and `logvex-hunter-v6.0.0.jar` (and optionally
   `logvex-worker-v6.0.0.jar`) in `~/.minecraft/mods`.
3. Launch the game.

Both mods need **Java 21** at runtime, which a stock 1.21.11 install already uses.

---

## Verifying a download

Every release ships `SHA256SUMS.txt`. Check a file with:

```bash
# Linux
sha256sum -c SHA256SUMS.txt

# Windows PowerShell
Get-FileHash .\Logvex-Fleet-Manager-v6.0.0-windows-x64-setup.exe -Algorithm SHA256
```

The printed hash must match the matching line in `SHA256SUMS.txt`.

---

## Connecting a bot to the Fleet Manager

The Fleet Manager does not talk to the Hunter addon; it drives **Logvex Worker** clients.

1. Open the Fleet Manager on the host machine.
2. **Dashboard → Generate pairing code** — copy the short code.
3. In the bot client's `config/logvex-worker.json`, set `host`, `port` and `pairingCode`, then start
   the client. The worker appears on the Dashboard.
4. Use the **Workers**, **Tasks**, **Commands**, **Regear** and **HIVE MODE** pages to control it.

See [`../USAGE.md`](../USAGE.md) for the full walkthrough and [`../host/README.md`](../host/README.md)
for every page and the REST API.

---

## Building from source

```bash
# Minecraft mods (needs JDK 25 to build; the mods run on Java 21)
export JAVA_HOME=/path/to/jdk-25
./gradlew clean test build
# -> build/libs/logvex-hunter-6.0.0.jar
# -> worker-mod/build/libs/logvex-worker-6.0.0.jar

# Fleet Manager (needs Node 20+)
cd host
npm install
npm run package:linux   # -> release/ (AppImage + .deb)
npm run package:win     # -> release/ (NSIS installer; needs Wine on Linux)
```

The version string lives in one place for the mods (`gradle/libs.versions.toml`, `mod-version`) and
in `host/package.json` / `bot/package.json` for the desktop apps. Bump all three together.
