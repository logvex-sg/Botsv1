package com.logvex.worker.meteor;

import com.logvex.worker.WorkerMod;
import com.logvex.worker.core.WorkerConfig;
import com.logvex.worker.core.WorkerLink;
import com.logvex.worker.core.WorkerSnapshot;
import com.logvex.worker.core.WorkerState;
import com.logvex.worker.mc.MinecraftTaskDispatcher;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.function.Consumer;

/**
 * The one place the worker's connection state lives.
 *
 * <p>Both halves of the mod go through this: {@link WorkerMod} owns the lifecycle (it loads the
 * config and starts the link when Minecraft launches) and the Fleet Manager Meteor modules read the
 * same instance for their HUDs and controls. That is deliberate — the spec forbids a second
 * configuration system, so there is exactly one {@link WorkerConfig}, one {@link WorkerLink} and one
 * event log, and the modules are views onto them.
 *
 * <p>It is safe to call {@link #get()} before {@link #init(Path)} has run: the accessors simply
 * report "not configured yet" until Minecraft's client initializer wires it up.
 */
public final class FleetRuntime {
    private static final int MAX_EVENTS = 200;

    private static final FleetRuntime INSTANCE = new FleetRuntime();

    public static FleetRuntime get() {
        return INSTANCE;
    }

    private volatile Consumer<String> logSink = message -> {};
    private final Deque<String> events = new ArrayDeque<>();
    private final List<Consumer<WorkerState>> stateListeners = new ArrayList<>();

    private volatile WorkerConfig config;
    private volatile Path configFile;
    private volatile MinecraftTaskDispatcher dispatcher;
    private volatile WorkerLink link;
    private volatile WorkerState state = WorkerState.DISCONNECTED;
    /** The latest status snapshot, refreshed by the Meteor ticker and reused by every module. */
    private volatile WorkerSnapshot cachedSnapshot = new WorkerSnapshot();

    private FleetRuntime() {}

    /** Builds the config, dispatcher and link. Called once from {@link WorkerMod}. */
    public synchronized void init(Path configFile) {
        this.configFile = configFile;
        this.config = WorkerConfig.load(configFile);
        this.dispatcher = new MinecraftTaskDispatcher(config);
        this.link = new WorkerLink(config, dispatcher, WorkerLink.ConnectionFactory.defaultFactory(), this::record);
        this.link.onStateChange(this::onState);
        record("worker configured for " + config.endpoint());
    }

    public boolean configured() {
        return link != null;
    }

    public WorkerConfig config() {
        return config;
    }

    public WorkerLink link() {
        return link;
    }

    public MinecraftTaskDispatcher dispatcher() {
        return dispatcher;
    }

    public WorkerState state() {
        return state;
    }

    /** The latest snapshot, refreshed on a slow interval so no module rebuilds it per frame. */
    public WorkerSnapshot snapshot() {
        return cachedSnapshot;
    }

    /** Recomputes the snapshot from the client. Cheap enough to call a few times a second. */
    public void refreshSnapshot() {
        MinecraftTaskDispatcher current = dispatcher;
        if (current == null) return;
        try {
            WorkerSnapshot next = current.snapshot();
            if (next != null) cachedSnapshot = next;
        } catch (RuntimeException ignored) {
            // A snapshot failure must never break the tick; the previous one stays visible.
        }
    }

    public boolean registered() {
        WorkerLink current = link;
        return current != null && current.isRegistered();
    }

    public void setLogSink(Consumer<String> sink) {
        this.logSink = sink == null ? message -> {} : sink;
    }

    /** Logs a line and keeps it for the console view. */
    public void record(String message) {
        if (message == null || message.isBlank()) return;
        String line = message;
        synchronized (events) {
            events.addLast(line);
            while (events.size() > MAX_EVENTS) events.removeFirst();
        }
        try {
            logSink.accept(line);
        } catch (RuntimeException ignored) {
            // Logging must never break the connection.
        }
    }

    /** Most recent events, newest last. */
    public List<String> recentEvents() {
        synchronized (events) {
            return new ArrayList<>(events);
        }
    }

    public void onStateChange(Consumer<WorkerState> listener) {
        if (listener != null) {
            synchronized (stateListeners) {
                stateListeners.add(listener);
            }
        }
    }

    public void start() {
        WorkerLink current = link;
        if (current != null) {
            current.start();
            record("connecting to " + (config == null ? "?" : config.endpoint()));
        }
    }

    public void stop() {
        WorkerLink current = link;
        if (current != null) {
            current.stop();
            record("disconnected on request");
        }
    }

    /** Persists the current config and restarts the link so a changed address takes effect. */
    public synchronized void applyConfig() {
        if (configFile != null && config != null) {
            WorkerConfig.save(configFile, config);
        }
        if (link != null) {
            link.stop();
            link.start();
            record("reconnecting to " + config.endpoint());
        }
    }

    private void onState(WorkerState next) {
        this.state = next;
        record("state: " + next.name().toLowerCase(java.util.Locale.ROOT));
        List<Consumer<WorkerState>> snapshot;
        synchronized (stateListeners) {
            snapshot = new ArrayList<>(stateListeners);
        }
        for (Consumer<WorkerState> listener : snapshot) {
            try {
                listener.accept(next);
            } catch (RuntimeException ignored) {
                // A listener must never break the link.
            }
        }
    }
}
