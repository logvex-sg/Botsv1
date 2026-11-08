package com.logvex.hunter.core;

import com.logvex.hunter.core.config.ConfigPaths;
import com.logvex.hunter.core.config.HunterConfig;
import com.logvex.hunter.core.event.EventBus;
import com.logvex.hunter.core.event.HunterEvents;
import com.logvex.hunter.core.instances.InstanceRegistry;
import com.logvex.hunter.core.message.MessageManager;
import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.session.SessionManager;
import com.logvex.hunter.core.stats.CombatEvent;
import com.logvex.hunter.core.stats.Statistics;
import com.logvex.hunter.core.store.AtomicFiles;
import com.logvex.hunter.core.target.TargetCandidate;
import com.logvex.hunter.core.target.TargetStore;
import com.logvex.hunter.core.target.TargetTracker;
import com.logvex.hunter.core.util.Json;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * The addon's shared state and services.
 *
 * <p>This is the single object the game layer talks to. It owns the configuration, the target
 * lists, the message system, the statistics, the instance registry and the session/history state,
 * and it exposes the persistence operations the GUI and commands need.
 *
 * <p>Everything here is Minecraft-free, which keeps the bulk of the addon unit-testable.
 */
public final class HunterCore {
    private final ConfigPaths paths;
    private final EventBus bus = new EventBus();
    private final SessionManager sessions = new SessionManager();

    private HunterConfig config;
    private TargetStore targets = new TargetStore();
    private MessageManager messages = new MessageManager();
    private Statistics statistics = new Statistics();
    private InstanceRegistry instances = new InstanceRegistry();
    private final TargetTracker tracker = new TargetTracker();

    private List<TargetCandidate> candidates = List.of();
    private TargetCandidate currentTarget;
    /** Number of this addon's modules currently active; supplied by the game layer. */
    private java.util.function.IntSupplier activeModuleCount = () -> 0;
    private String serverAddress = "";
    private String dimension = "";
    private boolean connected;
    private String lastStatusMessage = "";
    private boolean dirty;

    public HunterCore(ConfigPaths paths) {
        this.paths = paths;
    }

    // ------------------------------------------------------------- lifecycle

    /** Loads every persisted file, tolerating missing or corrupt ones. */
    public void load() {
        HunterConfig.LoadResult result = HunterConfig.load(paths.configFile());
        config = result.config();
        if (result.recovered()) lastStatusMessage = result.message();

        targets = loadTargets();
        messages = loadMessages();
        statistics = loadStatistics();
        instances = loadInstances();
    }

    private TargetStore loadTargets() {
        String text = AtomicFiles.read(paths.targetsFile());
        if (text == null || text.isBlank()) return new TargetStore();
        try {
            return TargetStore.fromJsonText(text);
        } catch (RuntimeException e) {
            backupAndReset(paths.targetsFile());
            lastStatusMessage = "targets.json was corrupt and has been reset: " + e.getMessage();
            return new TargetStore();
        }
    }

    private MessageManager loadMessages() {
        String text = AtomicFiles.read(paths.messagesFile());
        if (text == null || text.isBlank()) return new MessageManager();
        try {
            return MessageManager.fromJson(Json.parseObject(text));
        } catch (RuntimeException e) {
            backupAndReset(paths.messagesFile());
            lastStatusMessage = "messages.json was corrupt and has been reset: " + e.getMessage();
            return new MessageManager();
        }
    }

    private Statistics loadStatistics() {
        String text = AtomicFiles.read(paths.statisticsFile());
        if (text == null || text.isBlank()) return new Statistics();
        try {
            return Statistics.fromJson(Json.parseObject(text));
        } catch (RuntimeException e) {
            backupAndReset(paths.statisticsFile());
            lastStatusMessage = "statistics.json was corrupt and has been reset: " + e.getMessage();
            return new Statistics();
        }
    }

    private InstanceRegistry loadInstances() {
        String text = AtomicFiles.read(paths.instancesFile());
        if (text == null || text.isBlank()) return new InstanceRegistry();
        try {
            return InstanceRegistry.fromJson(Json.parseObject(text));
        } catch (RuntimeException e) {
            backupAndReset(paths.instancesFile());
            lastStatusMessage = "instances.json was corrupt and has been reset: " + e.getMessage();
            return new InstanceRegistry();
        }
    }

    private void backupAndReset(Path file) {
        try {
            AtomicFiles.backup(file);
        } catch (IOException ignored) {
            // best effort
        }
    }

    /** Persists every file. Returns a human-readable summary of what failed, or null on success. */
    public String saveAll() {
        try {
            AtomicFiles.ensureDirectory(paths.root());
            config.save(paths.configFile());
            AtomicFiles.write(paths.targetsFile(), targets.toJsonText());
            AtomicFiles.write(paths.messagesFile(), messages.toJsonText());
            statistics.setLastSavedAt(System.currentTimeMillis());
            AtomicFiles.write(paths.statisticsFile(), statistics.toJsonText());
            AtomicFiles.write(paths.instancesFile(), instances.toJsonText());
            dirty = false;
            return null;
        } catch (IOException e) {
            return "failed to save configuration: " + e.getMessage();
        }
    }

    public void markDirty() {
        dirty = true;
    }

    public boolean isDirty() {
        return dirty;
    }

    // -------------------------------------------------------------- accessors

    public ConfigPaths paths() {
        return paths;
    }

    public EventBus bus() {
        return bus;
    }

    public HunterConfig config() {
        return config;
    }

    public TargetStore targets() {
        return targets;
    }

    public void setTargets(TargetStore targets) {
        this.targets = targets == null ? new TargetStore() : targets;
        markDirty();
    }

    public MessageManager messages() {
        return messages;
    }

    public Statistics statistics() {
        return statistics;
    }

    public InstanceRegistry instances() {
        return instances;
    }

    public SessionManager sessions() {
        return sessions;
    }

    public TargetTracker tracker() {
        return tracker;
    }

    public List<TargetCandidate> candidates() {
        return candidates;
    }

    public void setCandidates(List<TargetCandidate> candidates) {
        this.candidates = candidates == null ? List.of() : candidates;
    }

    public TargetCandidate currentTarget() {
        return currentTarget;
    }

    public void setCurrentTarget(TargetCandidate target) {
        this.currentTarget = target;
    }

    public String serverAddress() {
        return serverAddress;
    }

    public void setServerAddress(String serverAddress) {
        this.serverAddress = serverAddress == null ? "" : serverAddress;
    }

    public String dimension() {
        return dimension;
    }

    public void setDimension(String dimension) {
        this.dimension = dimension == null ? "" : dimension;
    }

    public boolean connected() {
        return connected;
    }

    public void setConnected(boolean connected) {
        this.connected = connected;
    }

    public String lastStatusMessage() {
        return lastStatusMessage;
    }

    public void setLastStatusMessage(String message) {
        this.lastStatusMessage = message == null ? "" : message;
    }

    public boolean running() {
        return config.enabled() && !config.emergencyStop();
    }

    public void setActiveModuleCountSupplier(java.util.function.IntSupplier supplier) {
        this.activeModuleCount = supplier == null ? () -> 0 : supplier;
    }

    public int activeModuleCount() {
        return activeModuleCount.getAsInt();
    }

    // -------------------------------------------------------------- recording

    public void recordEvent(CombatEvent.Kind kind, String message, String detail) {
        statistics.addEvent(CombatEvent.now(kind, message, detail));
        markDirty();
    }

    /** Records an encounter with a player and updates the stored entry and history. */
    public void recordEncounter(PlayerSnapshot snapshot, double distance, long now) {
        statistics.addEncounter();
        if (snapshot != null) {
            var entry = targets.find(snapshot.uuid(), snapshot.name());
            if (entry != null) {
                entry.addEncounter();
                entry.markSeen(now);
                entry.setLastKnownPosition(snapshot.position());
                entry.setLastDimension(snapshot.dimension());
            }
            var history = sessions.history(snapshot.uuid(), snapshot.name());
            history.record(now, snapshot.dimension(), snapshot.position().x, snapshot.position().y,
                snapshot.position().z, distance, snapshot.health());
            history.addEncounter();
        }
        markDirty();
    }

    public void recordKill(String targetName) {
        statistics.addKill(targetName);
        recordEvent(CombatEvent.Kind.KILL, "Kill: " + targetName, "");
    }

    public void recordDeath() {
        statistics.addDeath();
        recordEvent(CombatEvent.Kind.DEATH, "Local player died", "");
    }

    /** Publishes an event and, when it is a target change, keeps the cached candidate in sync. */
    public void publish(Object event) {
        if (event instanceof HunterEvents.TargetSwitched switched) {
            bus.post(switched);
        } else {
            bus.post(event);
        }
    }

    // ------------------------------------------------------------- utilities

    public void resetSessionState() {
        tracker.reset();
        candidates = List.of();
        currentTarget = null;
    }

    /** Called on world change: keeps lists and statistics, forgets what was visible. */
    public void onWorldChanged(String newDimension) {
        setDimension(newDimension);
        tracker.resetVisibility();
        candidates = List.of();
        currentTarget = null;
        recordEvent(CombatEvent.Kind.INFO, "World changed", newDimension == null ? "" : newDimension);
    }

    public void onDisconnected() {
        setConnected(false);
        tracker.reset();
        candidates = List.of();
        currentTarget = null;
        serverAddress = "";
        recordEvent(CombatEvent.Kind.CONNECTION, "Disconnected", "");
    }

    public Map<String, Object> summaryJson() {
        Map<String, Object> map = Json.object();
        map.put("enabled", config.enabled());
        map.put("emergencyStop", config.emergencyStop());
        map.put("profile", config.activeProfileName());
        map.put("connected", connected);
        map.put("server", serverAddress);
        map.put("dimension", dimension);
        map.put("targets", targets.size());
        map.put("visible", tracker.visibleCount());
        map.put("candidates", candidates.size());
        map.put("kills", statistics.totalKills());
        map.put("deaths", statistics.totalDeaths());
        map.put("sessions", statistics.sessions());
        if (currentTarget != null) {
            map.put("currentTarget", currentTarget.name());
            map.put("currentTargetDistance", currentTarget.distance);
        }
        return map;
    }
}
