package com.logvex.hunter.core.event;

import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.stasis.StasisLevel;

/** Events published on the addon's {@link EventBus}. */
public final class HunterEvents {
    private HunterEvents() {}

    /** The set of visible candidates changed, or a scan completed. */
    public record ScanCompleted(long timestamp, int candidateCount, int visiblePlayers) {}

    /** A player entered the detection range for the first time in this session. */
    public record TargetDetected(PlayerSnapshot snapshot, TargetEntry entry, double distance) {}

    /** A previously visible player left the detection range. */
    public record TargetLost(PlayerSnapshot snapshot, TargetEntry entry, long lastSeen) {}

    /** A player that had been lost came back. */
    public record TargetReappeared(PlayerSnapshot snapshot, TargetEntry entry, double distance, long awayMillis) {}

    /** A player moved within the configured close range. */
    public record TargetEnteredRange(PlayerSnapshot snapshot, TargetEntry entry, double distance) {}

    /** The manually or automatically selected target changed. */
    public record TargetSwitched(PlayerSnapshot previous, PlayerSnapshot current, boolean manual) {}

    /** A controlled-session kill was recorded for the given player. */
    public record TargetEliminated(PlayerSnapshot snapshot, TargetEntry entry, String weapon) {}

    /** The local player died. */
    public record LocalPlayerDied(String cause) {}

    /** Health of the local player changed significantly. */
    public record LocalHealthChanged(double health, double previous) {}

    /** The defensive readiness level changed. */
    public record StasisChanged(StasisLevel previous, StasisLevel current, java.util.List<String> reasons) {}

    /** A module of this addon, or a managed Meteor combat module, changed state. */
    public record ModuleStateChanged(String module, boolean active, boolean managed) {}

    /** The connection to a server was established or lost. */
    public record ConnectionChanged(boolean connected, String serverAddress, String reason) {}

    /** An instance's status changed in the instance registry. */
    public record InstanceStatusChanged(String instanceId, String status, String detail) {}
}
