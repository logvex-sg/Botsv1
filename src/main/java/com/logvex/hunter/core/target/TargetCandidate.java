package com.logvex.hunter.core.target;

import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.model.TargetCategory;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.model.Vec3;

/** A player that passed the filters, together with the data used to rank it. */
public final class TargetCandidate {
    public final PlayerSnapshot snapshot;
    public final TargetEntry entry;
    public final double distance;
    public final int priority;
    public final TargetCategory category;

    public TargetCandidate(PlayerSnapshot snapshot, TargetEntry entry, double distance, int priority, TargetCategory category) {
        this.snapshot = snapshot;
        this.entry = entry;
        this.distance = distance;
        this.priority = priority;
        this.category = category;
    }

    public String name() {
        return snapshot.name() == null ? "unknown" : snapshot.name();
    }

    public boolean tracked() {
        return entry != null;
    }

    /** A single number used by {@link SortMode#PRIORITY}: lower is better. */
    public double score() {
        return priority * 1000.0 + distance;
    }

    @Override
    public String toString() {
        return name() + " d=" + String.format(java.util.Locale.ROOT, "%.1f", distance) + " p=" + priority;
    }
}
