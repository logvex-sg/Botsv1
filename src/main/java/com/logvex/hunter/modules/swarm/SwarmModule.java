package com.logvex.hunter.modules.swarm;

import com.logvex.hunter.HunterAddon;
import com.logvex.hunter.companion.CompanionCommands;
import com.logvex.hunter.core.swarm.SwarmCommandGate;
import com.logvex.hunter.core.swarm.SwarmMessage;
import com.logvex.hunter.core.swarm.SwarmProtocol;
import com.logvex.hunter.core.swarm.SwarmRoster;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.modules.HunterModule;
import meteordevelopment.meteorclient.events.world.TickEvent;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.EnumSetting;
import meteordevelopment.meteorclient.settings.IntSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;
import meteordevelopment.meteorclient.settings.StringSetting;
import meteordevelopment.orbit.EventHandler;
import net.minecraft.client.Minecraft;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;

/**
 * In-game multi-client control, in the spirit of Meteor's own Swarm.
 *
 * <p>One client runs as the <b>host</b> and any number of others run as <b>workers</b>. The host
 * accepts connections, keeps a roster of who is online and broadcasts commands; a worker applies
 * whatever the host sends. Unlike a plain command relay, every command is routed through the same
 * {@link com.logvex.hunter.core.control.ControlService} the local player uses, so the host can
 * control each worker's hunter state, target list, modules and settings.
 *
 * <p>Threading: the sockets run on daemon threads and never touch the game. Incoming commands are
 * queued and drained on the client tick; outgoing results are sent straight back from the tick.
 * Nothing here blocks the game thread and no allocation happens per tick beyond the drain itself.
 */
public class SwarmModule extends HunterModule {
    /** Modes this client can run in. */
    public enum Mode {
        HOST,
        WORKER
    }

    private final SettingGroup sgGeneral = settings.getDefaultGroup();
    private final SettingGroup sgHost = settings.createGroup("Host");
    private final SettingGroup sgWorker = settings.createGroup("Worker");

    private final Setting<Mode> mode = sgGeneral.add(new EnumSetting.Builder<Mode>()
        .name("mode").description("Run this client as the swarm host, or as a worker.")
        .defaultValue(Mode.HOST)
        .onChanged(value -> restart())
        .build());

    private final Setting<Boolean> autoStart = sgGeneral.add(new BoolSetting.Builder()
        .name("auto-start").description("Start the swarm link when the client joins a world.")
        .defaultValue(true)
        .onChanged(this::onAutoStartChanged)
        .build());

    private final Setting<Boolean> announce = sgGeneral.add(new BoolSetting.Builder()
        .name("announce").description("Report worker joins, leaves and results in chat.")
        .defaultValue(true)
        .build());

    private final Setting<Boolean> allowCombatBroadcast = sgGeneral.add(new BoolSetting.Builder()
        .name("allow-combat-broadcast")
        .description("Let a broadcast change combat modules on the whole fleet. Off by default.")
        .defaultValue(false)
        .onChanged(value -> {
            core().config().setSwarmAllowCombatBroadcast(value);
            core().markDirty();
        })
        .build());

    private final Setting<Integer> hostPort = sgHost.add(new IntSetting.Builder()
        .name("port").description("Port the host listens on.")
        .defaultValue(6969).min(1).sliderRange(1024, 65535)
        .visible(() -> mode.get() == Mode.HOST)
        .onChanged(value -> restart())
        .build());

    private final Setting<String> hostToken = sgHost.add(new StringSetting.Builder()
        .name("token").description("Shared token workers must present. Empty accepts anyone on the port.")
        .defaultValue("")
        .visible(() -> mode.get() == Mode.HOST)
        .onChanged(value -> restart())
        .build());

    private final Setting<Boolean> hostAllowRemote = sgHost.add(new BoolSetting.Builder()
        .name("allow-remote").description("Accept workers from other machines. Off keeps it on loopback.")
        .defaultValue(false)
        .visible(() -> mode.get() == Mode.HOST)
        .onChanged(value -> restart())
        .build());

    private final Setting<String> workerHost = sgWorker.add(new StringSetting.Builder()
        .name("host").description("Address of the swarm host.")
        .defaultValue("127.0.0.1")
        .visible(() -> mode.get() == Mode.WORKER)
        .onChanged(value -> restart())
        .build());

    private final Setting<Integer> workerPort = sgWorker.add(new IntSetting.Builder()
        .name("port").description("Port of the swarm host.")
        .defaultValue(6969).min(1).sliderRange(1024, 65535)
        .visible(() -> mode.get() == Mode.WORKER)
        .onChanged(value -> restart())
        .build());

    private final Setting<String> workerToken = sgWorker.add(new StringSetting.Builder()
        .name("token").description("Shared token the host expects.")
        .defaultValue("")
        .visible(() -> mode.get() == Mode.WORKER)
        .onChanged(value -> restart())
        .build());

    private final SwarmRoster roster = new SwarmRoster();
    private final Deque<Runnable> clientActions = new ArrayDeque<>();

    private SwarmHostServer host;
    private SwarmWorkerClient worker;
    private boolean applying;
    private long lastPing;

    public SwarmModule() {
        super(HunterAddon.CATEGORY, "swarm",
            "Controls other LogVex Hunter clients from one host, in game.");
    }

    // ------------------------------------------------------------- lifecycle

    @Override
    public void onActivate() {
        core().statistics().recordModuleActivation(name);
        applySettings();
        if (autoStart.get()) start();
    }

    @Override
    public void onDeactivate() {
        stop();
    }

    /**
     * On emergency stop the host also tells every worker to stop, before the link is torn down.
     * Stopping the whole fleet is always permitted, so this does not consult the broadcast gate.
     */
    @Override
    public void onEmergencyStop() {
        if (mode.get() == Mode.HOST && host != null && !roster.isEmpty()) {
            roster.broadcast(SwarmMessage.of(SwarmProtocol.COMMAND)
                .with(SwarmProtocol.FIELD_LINE, "emergency-stop")
                .with(SwarmProtocol.FIELD_TIME, System.currentTimeMillis()));
            // The stop is queued on each socket thread; give it a moment to leave before the link
            // is torn down, so the fleet actually receives it.
            roster.flush(300);
        }
        super.onEmergencyStop();
    }

    @EventHandler
    private void onTick(TickEvent.Post event) {
        drainClientActions();
        if (!isActive()) return;
        if (mode.get() == Mode.HOST) {
            if (host == null || !host.running()) return;
            long now = System.currentTimeMillis();
            if (now - lastPing >= 5000) {
                lastPing = now;
                host.roster().broadcast(SwarmMessage.of(SwarmProtocol.PING)
                    .with(SwarmProtocol.FIELD_TIME, now));
                host.roster().prune(now, 30000);
            }
        } else if (worker != null) {
            String command;
            while ((command = worker.pollCommand()) != null) {
                runWorkerCommand(command);
            }
            long now = System.currentTimeMillis();
            if (now - lastPing >= 5000 && worker.connected()) {
                lastPing = now;
                worker.sendStatus(core().running() ? "running" : "stopped",
                    core().serverAddress() + " " + core().targets().size() + " targets");
            }
        }
    }

    /** Drains work queued from the socket threads. Always runs on the client thread. */
    private void drainClientActions() {
        Runnable action;
        while ((action = clientActions.poll()) != null) {
            try {
                action.run();
            } catch (RuntimeException e) {
                HunterChat.error("Swarm action failed: " + e.getMessage());
            }
        }
    }

    // ---------------------------------------------------------------- control

    /** Starts the link for the current mode. Safe to call repeatedly. */
    public void start() {
        stop();
        if (mode.get() == Mode.HOST) startHost();
        else startWorker();
    }

    public void stop() {
        if (host != null) {
            host.stop();
            host = null;
        }
        if (worker != null) {
            worker.disconnect();
            worker = null;
        }
        roster.clear();
    }

    public boolean isHosting() {
        return host != null && host.running();
    }

    public boolean isWorkerConnected() {
        return worker != null && worker.connected();
    }

    public Mode mode() {
        return mode.get();
    }

    public SwarmRoster roster() {
        return roster;
    }

    public int boundPort() {
        return host != null ? host.boundPort() : hostPort.get();
    }

    public String workerEndpoint() {
        return workerHost.get() + ":" + workerPort.get();
    }

    public String workerStatus() {
        if (worker == null) return "not started";
        if (worker.connected()) return "connected to " + worker.endpoint();
        return worker.lastError().isBlank() ? "disconnected" : "disconnected (" + worker.lastError() + ")";
    }

    /** Sets the mode and restarts the link. */
    public void setMode(Mode newMode) {
        mode.set(newMode);
    }

    /** Sets the shared token on whichever side of the link this client is running. */
    public void setToken(String token) {
        if (mode.get() == Mode.HOST) hostToken.set(token == null ? "" : token);
        else workerToken.set(token == null ? "" : token);
    }

    /** Sets the listen/connect port and restarts the link. */
    public void setPort(int port) {
        if (mode.get() == Mode.HOST) hostPort.set(port);
        else workerPort.set(port);
    }

    /** Points a worker at a host and restarts the link. */
    public void setWorkerEndpoint(String host, int port) {
        workerHost.set(host == null || host.isBlank() ? "127.0.0.1" : host.trim());
        workerPort.set(port);
    }

    // ----------------------------------------------------------- host actions

    /** Sends a command to one worker. Returns {@code null} on success, otherwise an error. */
    public String sendTo(String selector, String command) {
        if (host == null) return "the swarm host is not running";
        if (command == null || command.isBlank()) return "empty command";
        var peer = roster.resolve(selector);
        if (peer == null) return "no worker matches '" + selector + "'";
        if (!allowCombatBroadcast.get() && SwarmCommandGate.armsCombat(command)) {
            HunterChat.warn("Sending a combat-arming command to one worker: " + command.trim());
        }
        String error = roster.send(peer.id(), SwarmMessage.of(SwarmProtocol.COMMAND)
            .with(SwarmProtocol.FIELD_LINE, command.trim())
            .with(SwarmProtocol.FIELD_TIME, System.currentTimeMillis()));
        if (error == null && announce.get()) HunterChat.info("Sent to " + peer.label() + ": " + command.trim());
        return error;
    }

    /**
     * Sends a command to every worker.
     *
     * @return a human-readable result; the command is refused when the gate rejects it
     */
    public String broadcast(String command) {
        if (host == null) return "the swarm host is not running";
        if (command == null || command.isBlank()) return "empty command";
        SwarmCommandGate.Verdict verdict = SwarmCommandGate.inspect(command, allowCombatBroadcast.get());
        if (!verdict.allowed()) return "refused: " + verdict.reason();
        int sent = roster.broadcast(SwarmMessage.of(SwarmProtocol.COMMAND)
            .with(SwarmProtocol.FIELD_LINE, command.trim())
            .with(SwarmProtocol.FIELD_TIME, System.currentTimeMillis()));
        return "sent to " + sent + " worker" + (sent == 1 ? "" : "s");
    }

    public boolean kick(String selector) {
        return roster.kick(selector);
    }

    public String describeRoster() {
        return roster.describe();
    }

    // --------------------------------------------------------- worker actions

    private void runWorkerCommand(String command) {
        String output;
        boolean ok = true;
        try {
            output = CompanionCommands.run(command);
            if (output != null && output.startsWith("unrecognised")) ok = false;
        } catch (RuntimeException e) {
            ok = false;
            output = "error: " + e.getMessage();
        }
        if (worker != null) worker.sendResult(command, ok, output == null ? "" : output);
        if (announce.get()) HunterChat.info("Host command: " + command + " -> " + (output == null ? "" : output));
    }

    // --------------------------------------------------------------- internal

    private void startHost() {
        try {
            host = new SwarmHostServer(hostPort.get(), hostToken.get(), hostAllowRemote.get(), roster,
                (id, message) -> clientActions.add(() -> handleHostMessage(id, message)),
                message -> clientActions.add(() -> {
                    if (announce.get()) HunterChat.info(message);
                }));
            host.start();
            String bind = hostAllowRemote.get() ? "all interfaces" : "loopback only";
            HunterChat.info("Swarm host listening on port " + host.boundPort() + " (" + bind + ").");
            if (hostToken.get().isBlank()) {
                HunterChat.warn("Swarm host token is empty: anyone who can reach the port may join.");
            }
        } catch (Exception e) {
            host = null;
            HunterChat.error("Could not start the swarm host: " + e.getMessage());
        }
    }

    private void startWorker() {
        worker = new SwarmWorkerClient(workerHost.get(), workerPort.get(), workerToken.get(),
            core().config().instanceLabel().isBlank() ? playerName() : core().config().instanceLabel(),
            (state, up) -> clientActions.add(() -> {
                if (announce.get()) {
                    if (up) HunterChat.info("Swarm: " + state + " to " + workerEndpoint());
                    else HunterChat.warn("Swarm: " + state);
                }
            }));
        worker.start();
        HunterChat.info("Swarm worker connecting to " + workerEndpoint() + "...");
    }

    private void handleHostMessage(String id, SwarmMessage message) {
        var peer = roster.get(id);
        if (peer == null) return;
        peer.touch(System.currentTimeMillis());
        switch (message.type()) {
            case SwarmProtocol.STATUS -> {
                peer.setStatus(message.string(SwarmProtocol.FIELD_STATUS));
                if (announce.get() && !message.string(SwarmProtocol.FIELD_DATA).isBlank()) {
                    HunterChat.info(peer.label() + ": " + message.string(SwarmProtocol.FIELD_DATA));
                }
            }
            case SwarmProtocol.RESULT -> {
                peer.incrementResultsReceived();
                peer.setLastResult(message.string(SwarmProtocol.FIELD_OUTPUT));
                if (announce.get()) {
                    HunterChat.info(peer.label() + " <- " + message.string(SwarmProtocol.FIELD_LINE)
                        + ": " + message.string(SwarmProtocol.FIELD_OUTPUT));
                }
            }
            case SwarmProtocol.PONG -> peer.setLastLatencyMillis(
                System.currentTimeMillis() - message.number(SwarmProtocol.FIELD_TIME, 0));
            default -> {
                // ignore unknown types so a newer worker can add fields safely
            }
        }
    }

    private void restart() {
        if (applying) return;
        persistSettings();
        if (isActive()) start();
    }

    private void onAutoStartChanged(boolean value) {
        if (applying) return;
        core().config().setSwarmAutoConnect(value);
        core().markDirty();
    }

    private void applySettings() {
        applying = true;
        try {
            var config = core().config();
            mode.set(config.swarmHostMode() ? Mode.HOST : Mode.WORKER);
            hostPort.set(config.swarmHostPort());
            hostToken.set(config.swarmHostToken());
            hostAllowRemote.set(config.swarmHostAllowRemote());
            workerHost.set(config.swarmWorkerHost());
            workerPort.set(config.swarmWorkerPort());
            // The host token is the single shared secret, used on both sides of the link.
            workerToken.set(config.swarmHostToken());
            allowCombatBroadcast.set(config.swarmAllowCombatBroadcast());
            autoStart.set(config.swarmAutoConnect());
        } finally {
            applying = false;
        }
    }

    private void persistSettings() {
        var config = core().config();
        config.setSwarmHostMode(mode.get() == Mode.HOST);
        config.setSwarmHostPort(hostPort.get());
        // One shared secret: persist whichever side of the link this client is running.
        config.setSwarmHostToken(mode.get() == Mode.HOST ? hostToken.get() : workerToken.get());
        config.setSwarmHostAllowRemote(hostAllowRemote.get());
        config.setSwarmWorkerHost(workerHost.get());
        config.setSwarmWorkerPort(workerPort.get());
        config.setSwarmAllowCombatBroadcast(allowCombatBroadcast.get());
        config.setSwarmAutoConnect(autoStart.get());
        core().markDirty();
    }

    private static String playerName() {
        var player = Minecraft.getInstance().player;
        return player == null ? "worker" : player.getName().getString();
    }

    /** A one-line summary for the HUD and the dashboard. */
    public String summary() {
        if (mode.get() == Mode.HOST) {
            return isHosting() ? "host :" + boundPort() + " - " + roster.summary() : "host stopped";
        }
        return "worker " + workerStatus();
    }

    @Override
    public String getInfoString() {
        return mode.get() == Mode.HOST ? "Host" : "Worker";
    }

    /** The status lines shown in the swarm screen. */
    public List<String> statusLines() {
        if (mode.get() == Mode.HOST) {
            List<String> lines = new java.util.ArrayList<>();
            lines.add(isHosting() ? "Hosting on port " + boundPort() : "Host is not running");
            lines.add("Workers: " + roster.size());
            return lines;
        }
        return List.of("Worker mode", workerStatus());
    }
}
