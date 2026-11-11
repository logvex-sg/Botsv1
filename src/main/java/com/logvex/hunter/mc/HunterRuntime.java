package com.logvex.hunter.mc;

import com.logvex.hunter.HunterAddon;
import com.logvex.hunter.core.HunterCore;
import com.logvex.hunter.core.config.ConfigPaths;
import com.logvex.hunter.core.equipment.EquipmentSnapshot;
import com.logvex.hunter.core.equipment.InventoryStatus;
import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.model.Vec3;
import com.logvex.hunter.core.stats.CombatEvent;
import meteordevelopment.meteorclient.MeteorClient;
import meteordevelopment.meteorclient.events.game.GameJoinedEvent;
import meteordevelopment.meteorclient.events.game.GameLeftEvent;
import meteordevelopment.meteorclient.events.world.TickEvent;
import meteordevelopment.orbit.EventHandler;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;

import java.util.ArrayList;
import java.util.List;

/**
 * The bridge between the running game and the Minecraft-free core.
 *
 * <p>It owns the {@link HunterCore}, samples the client state once per tick and caches the result so
 * every module reading within the same tick shares one snapshot. Everything runs on the client
 * thread: it only reads client state, which is not thread safe.
 */
public final class HunterRuntime {
    private static HunterRuntime instance;

    private final Minecraft mc = Minecraft.getInstance();
    private final HunterCore core;

    private int tickId;
    private long tickMillis;
    private int snapshotTick = -1;
    private List<PlayerSnapshot> playerCache = List.of();
    private int equipmentTick = -1;
    private EquipmentSnapshot equipmentCache;
    private InventoryStatus inventoryCache;

    private String lastServer = "";
    private String lastDimension = "";
    private boolean lastConnected;
    private double lastHealth = -1;

    private HunterRuntime() {
        ConfigPaths paths = new ConfigPaths(FabricLoader.getInstance().getConfigDir());
        this.core = new HunterCore(paths);
        this.core.load();
        // Forward every core event onto Meteor's bus, so modules that listen with @EventHandler
        // actually receive it. The core itself stays Minecraft-free.
        this.core.setEventSink(event -> {
            if (MeteorClient.EVENT_BUS != null) MeteorClient.EVENT_BUS.post(event);
        });
    }

    /** Creates (once) and returns the runtime. Must be called after Minecraft has started. */
    public static HunterRuntime get() {
        if (instance == null) {
            instance = new HunterRuntime();
            MeteorClient.EVENT_BUS.subscribe(instance);
        }
        return instance;
    }

    public static HunterRuntime peek() {
        return instance;
    }

    public HunterCore core() {
        return core;
    }

    public long now() {
        return System.currentTimeMillis();
    }

    public int tickId() {
        return tickId;
    }

    // ----------------------------------------------------------------- ticking

    @EventHandler
    private void onTick(TickEvent.Post event) {
        tickId++;
        tickMillis = System.currentTimeMillis();

        boolean connected = mc.player != null && mc.level != null;
        String server = resolveServer();
        String dimension = resolveDimension();

        if (!dimension.equals(lastDimension) && !dimension.isEmpty()) {
            core.onWorldChanged(dimension);
        }
        if (connected != lastConnected) {
            core.setConnected(connected);
            core.publish(new com.logvex.hunter.core.event.HunterEvents.ConnectionChanged(
                connected, server, connected ? "connected" : "disconnected"));
        }
        if (!server.equals(lastServer)) {
            core.setServerAddress(server);
        }
        if (!dimension.equals(lastDimension)) {
            core.setDimension(dimension);
        }

        double health = localHealth();
        if (connected && lastHealth >= 0 && Math.abs(health - lastHealth) >= 0.5) {
            core.publish(new com.logvex.hunter.core.event.HunterEvents.LocalHealthChanged(health, lastHealth));
        }
        lastHealth = connected ? health : -1;

        lastServer = server;
        lastDimension = dimension;
        lastConnected = connected;
    }

    @EventHandler
    private void onGameJoined(GameJoinedEvent event) {
        core.setConnected(true);
        core.setServerAddress(resolveServer());
        core.setDimension(resolveDimension());
        if (core.config().autoStartTracking() && !core.sessions().isActive()) {
            core.sessions().start(Long.toString(now(), 36), now(), core.serverAddress(), core.dimension());
            core.recordEvent(CombatEvent.Kind.INFO, "Session started", core.serverAddress());
        }
    }

    @EventHandler
    private void onGameLeft(GameLeftEvent event) {
        core.onDisconnected();
        var closed = core.sessions().stop(now());
        if (closed != null) core.statistics().addSession(closed);
        core.saveAll();
        lastServer = "";
        lastDimension = "";
        lastConnected = false;
    }

    // -------------------------------------------------------------- snapshots

    /** All players currently visible to the client, as Minecraft-free snapshots. */
    public List<PlayerSnapshot> players() {
        if (snapshotTick == tickId) return playerCache;
        snapshotTick = tickId;
        if (mc.level == null || mc.player == null) {
            playerCache = List.of();
            return playerCache;
        }
        String dimension = resolveDimension();
        long now = tickMillis == 0 ? System.currentTimeMillis() : tickMillis;
        List<PlayerSnapshot> list = new ArrayList<>();
        for (var player : mc.level.players()) {
            if (player == mc.player) continue;
            list.add(PlayerScanner.snapshot(player, dimension, now));
        }
        playerCache = list;
        return playerCache;
    }

    public EquipmentSnapshot equipment() {
        if (equipmentTick == tickId) return equipmentCache;
        equipmentTick = tickId;
        long now = tickMillis == 0 ? System.currentTimeMillis() : tickMillis;
        equipmentCache = PlayerScanner.equipment(mc.player, now);
        inventoryCache = PlayerScanner.inventory(mc.player);
        return equipmentCache;
    }

    public InventoryStatus inventory() {
        if (equipmentTick != tickId) equipment();
        return inventoryCache;
    }

    public Vec3 localPosition() {
        if (mc.player == null) return Vec3.ZERO;
        return new Vec3(mc.player.getX(), mc.player.getY(), mc.player.getZ());
    }

    public double localHealth() {
        return mc.player == null ? 0 : mc.player.getHealth() + mc.player.getAbsorptionAmount();
    }

    public int localArmor() {
        return mc.player == null ? 0 : mc.player.getArmorValue();
    }

    public String localWeapon() {
        return PlayerScanner.weaponName(mc.player);
    }

    public boolean connected() {
        return mc.player != null && mc.level != null;
    }

    public String dimension() {
        return resolveDimension();
    }

    public String serverAddress() {
        return resolveServer();
    }

    private String resolveDimension() {
        if (mc.level == null) return "";
        return mc.level.dimension().identifier().toString();
    }

    private String resolveServer() {
        if (mc.hasSingleplayerServer()) return "singleplayer";
        ServerData data = mc.getCurrentServer();
        if (data == null) return mc.level == null ? "" : "singleplayer";
        return data.ip == null || data.ip.isBlank() ? "unknown" : data.ip;
    }

    /** Writes the persisted state; returns an error message or {@code null} on success. */
    public String save() {
        return core.saveAll();
    }

    public static void logDebug(String message) {
        if (instance != null && instance.core.config().debugLogging()) {
            HunterAddon.LOG.info("[hunter] {}", message);
        }
    }
}
