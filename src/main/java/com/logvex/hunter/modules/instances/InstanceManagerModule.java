package com.logvex.hunter.modules.instances;

import com.logvex.hunter.HunterAddon;
import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.event.HunterEvents;
import com.logvex.hunter.core.instances.InstanceHttpServer;
import com.logvex.hunter.core.instances.InstanceProbe;
import com.logvex.hunter.core.instances.InstanceRecord;
import com.logvex.hunter.core.instances.InstanceStats;
import com.logvex.hunter.core.stats.CombatEvent;
import com.logvex.hunter.mc.HunterChat;
import com.logvex.hunter.mc.HunterRuntime;
import com.logvex.hunter.modules.HunterModule;
import meteordevelopment.meteorclient.events.world.TickEvent;
import meteordevelopment.meteorclient.settings.BoolSetting;
import meteordevelopment.meteorclient.settings.IntSetting;
import meteordevelopment.meteorclient.settings.Setting;
import meteordevelopment.meteorclient.settings.SettingGroup;
import meteordevelopment.orbit.EventHandler;

import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Manages the other client instances the user has registered.
 *
 * <p>Each instance is polled over its own authenticated HTTP endpoint on a background daemon
 * thread, so the game thread never blocks on the network. Only read-only statistics cross the
 * boundary. The per-instance emergency stop is an explicit, authenticated command.
 */
public class InstanceManagerModule extends HunterModule {
    private final SettingGroup sgGeneral = settings.getDefaultGroup();

    private final Setting<Integer> pollInterval = sgGeneral.add(new IntSetting.Builder()
        .name("poll-interval").description("Seconds between status polls of every instance.")
        .defaultValue(10).min(2).sliderRange(2, 120).build());

    private final Setting<Integer> timeout = sgGeneral.add(new IntSetting.Builder()
        .name("timeout").description("HTTP timeout in milliseconds.")
        .defaultValue(1500).min(200).sliderRange(200, 10000).build());

    private final Setting<Boolean> announce = sgGeneral.add(new BoolSetting.Builder()
        .name("announce-changes").description("Report instance status changes in chat.")
        .defaultValue(false).build());

    private final Setting<Boolean> exposeStatus = sgGeneral.add(new BoolSetting.Builder()
        .name("expose-status")
        .description("Run a local HTTP endpoint so other instances can read this one's statistics.")
        .defaultValue(false).build());

    private final Setting<Integer> exposePort = sgGeneral.add(new IntSetting.Builder()
        .name("expose-port").description("Port of this instance's status endpoint.")
        .defaultValue(0).min(0).sliderRange(0, 65535).visible(exposeStatus::get).build());

    private ScheduledExecutorService executor;
    private InstanceHttpServer server;
    private volatile boolean polling;

    public InstanceManagerModule() {
        super(HunterAddon.CATEGORY, "instance-manager", "Polls and controls the other registered client instances.");
    }

    @EventHandler
    private void onTick(TickEvent.Post event) {
        if (!core().running()) return;
        if (exposeStatus.get() && server == null) startServer();
        if (!exposeStatus.get() && server != null) stopServer();
        if (!polling && executor != null && !executor.isShutdown()) {
            polling = true;
            executor.execute(this::pollAll);
        }
    }

    @Override
    public void onActivate() {
        super.onActivate();
        core().statistics().recordModuleActivation(name);
        if (executor == null || executor.isShutdown()) {
            executor = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread thread = new Thread(r, "logvex-hunter-instances");
                thread.setDaemon(true);
                return thread;
            });
        }
        if (exposeStatus.get()) startServer();
    }

    @Override
    public void onDeactivate() {
        super.onDeactivate();
        stopServer();
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
        polling = false;
    }

    // -------------------------------------------------------------- polling

    private void pollAll() {
        try {
            HunterCore core = core();
            if (!core.running()) return;
            List<InstanceRecord> records = core.instances().all();
            for (InstanceRecord record : records) {
                if (!record.enabled()) continue;
                pollOne(record);
            }
        } finally {
            polling = false;
        }
    }

    private void pollOne(InstanceRecord record) {
        HunterCore core = core();
        long now = System.currentTimeMillis();
        if (record.transport() == com.logvex.hunter.core.instances.InstanceTransport.READ_ONLY && record.port() <= 0) {
            return;
        }
        InstanceProbe.Result result = InstanceProbe.fetch(record, timeout.get());
        com.logvex.hunter.core.instances.InstanceStatus previous = record.status();
        if (result.ok()) {
            record.markOnline(now, result.latencyMillis());
            record.setLastStats(result.stats().toJson());
        } else {
            record.markOffline(now, result.error());
        }
        if (record.status() != previous) {
            core.publish(new HunterEvents.InstanceStatusChanged(record.id(), record.status().key(), record.lastError()));
            if (announce.get()) {
                HunterChat.info("Instance " + record.label() + " is now " + record.status().displayName());
            }
        }
    }

    // ------------------------------------------------------------- controls

    public boolean addInstance(String label, String host, int port, String token, boolean writable) {
        HunterCore core = core();
        String id = label.toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9_-]", "-");
        if (core.instances().get(id) != null) id = id + "-" + Long.toString(System.currentTimeMillis(), 36);
        InstanceRecord record = new InstanceRecord(id, label);
        record.setHost(host);
        record.setPort(port);
        record.setToken(token);
        record.setTransport(writable
            ? com.logvex.hunter.core.instances.InstanceTransport.HTTP
            : com.logvex.hunter.core.instances.InstanceTransport.READ_ONLY);
        core.instances().add(record);
        core.markDirty();
        return true;
    }

    public boolean removeInstance(String id) {
        boolean removed = core().instances().remove(id);
        if (removed) core().markDirty();
        return removed;
    }

    /** Sends the emergency stop to one instance. Returns {@code null} on success. */
    public String emergencyStop(String id) {
        InstanceRecord record = core().instances().get(id);
        if (record == null) return "unknown instance";
        if (!record.canSendCommands()) return "instance is read-only or has no token";
        String error = InstanceProbe.emergencyStop(record, timeout.get());
        core().recordEvent(CombatEvent.Kind.INFO, "Instance emergency stop: " + record.label(), error == null ? "ok" : error);
        return error;
    }

    public InstanceStats selfStats() {
        HunterCore core = core();
        HunterRuntime runtime = runtime();
        String status = core.running() ? (core.config().emergencyStop() ? "emergency-stop" : "running") : "stopped";
        return new InstanceStats(
            core.config().instanceId(),
            core.config().instanceLabel(),
            runtime.now(),
            core.serverAddress(),
            core.statistics().totalKills(),
            core.statistics().totalDeaths(),
            core.targets().size(),
            runtime.localHealth(),
            runtime.localArmor(),
            runtime.inventory().totems,
            runtime.connected(),
            status,
            core.activeModuleCount());
    }

    /** Called by the endpoint thread; hops back to the client thread before touching game state. */
    private void emergencyStopLocal() {
        net.minecraft.client.Minecraft.getInstance().execute(() -> {
            core().config().setEmergencyStop(true);
            core().saveAll();
            HunterChat.error("Emergency stop requested by a remote instance.");
        });
    }

    // ------------------------------------------------------------- endpoint

    private void startServer() {
        if (server != null) return;
        int port = exposePort.get();
        if (port <= 0) {
            HunterChat.warn("Instance status endpoint is enabled but no port is set.");
            return;
        }
        try {
            server = new InstanceHttpServer(port, core().config().controlToken(),
                core().config().allowRemoteControl(), () -> selfStats().toJsonText(), this::emergencyStopLocal);
            server.start();
            HunterChat.info("Instance status endpoint listening on port " + port);
        } catch (Exception e) {
            server = null;
            HunterChat.error("Could not start instance endpoint: " + e.getMessage());
        }
    }

    private void stopServer() {
        if (server == null) return;
        server.stop();
        server = null;
    }
}
