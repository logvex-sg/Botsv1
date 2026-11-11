package com.logvex.worker.meteor;

import com.logvex.worker.core.WorkerSnapshot;
import meteordevelopment.meteorclient.systems.modules.Module;

/**
 * Base class for every Fleet Manager module.
 *
 * <p>All nine modules are views onto the one {@link FleetRuntime}: they never hold their own
 * connection, config or snapshot, they read the shared instance. That keeps the in-game state and
 * the host's state identical by construction — there is a single source of truth, not two that have
 * to be kept in sync.
 */
public abstract class FleetModule extends Module {
    protected FleetModule(String name, String description, String... aliases) {
        super(FleetAddon.CATEGORY, name, description, aliases);
    }

    protected FleetRuntime runtime() {
        return FleetRuntime.get();
    }

    /** The most recent cached snapshot; never null, but empty before the client is in a world. */
    protected WorkerSnapshot snapshot() {
        return FleetRuntime.get().snapshot();
    }

    /** A short, human status line for HUDs and widgets, e.g. "registered" or "disconnected". */
    protected String connectionLabel() {
        FleetRuntime runtime = runtime();
        if (!runtime.configured()) return "not configured";
        return switch (runtime.state()) {
            case REGISTERED -> "registered";
            case CONNECTED, HANDSHAKING -> "handshaking";
            case CONNECTING -> "connecting";
            case BACKING_OFF -> "retrying";
            case DISCONNECTED -> "disconnected";
        };
    }

    /**
     * Called by {@link FleetTicker} so an open module panel can refresh its labels.
     *
     * <p>Meteor builds a module's widget once when its screen opens, so a panel that wants live
     * values keeps references to its labels and rewrites them here rather than rebuilding widgets.
     */
    public void refresh() {}
}
