package com.logvex.hunter.core.target;

import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.model.TargetCategory;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.model.Vec3;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Pure target-selection logic: turns the visible players into a ranked list of candidates.
 *
 * <p>Filtering is deliberately conservative. A player is rejected when it is out of range, is a
 * friend or on the ignore list, is naked while "ignore naked" is on, has no weapon while a weapon
 * is required, or is invisible. When a player is tracked in one of the lists its stored priority
 * and category are used; otherwise it counts as an untracked {@link TargetCategory#TEMPORARY}
 * candidate with the default priority.
 */
public final class TargetSelector {
    public static final int DEFAULT_PRIORITY = 5;

    private TargetSelector() {}

    /**
     * @param self           the local player's position (used for distance), may be null
     * @param players        the currently visible players
     * @param store          the target lists
     * @param filters        the tracking filter settings
     * @param sort           the ordering to apply
     * @param maxCandidates  how many candidates to keep, or {@code <= 0} for no limit
     */
    public static List<TargetCandidate> select(Vec3 self, List<PlayerSnapshot> players, TargetStore store,
                                               TargetFilterSettings filters, SortMode sort, int maxCandidates) {
        List<TargetCandidate> candidates = new ArrayList<>();
        if (players == null) return candidates;

        for (PlayerSnapshot player : players) {
            if (player == null) continue;
            TargetEntry entry = store.find(player.uuid(), player.name());

            if (!passes(player, entry, filters)) continue;

            double distance = self == null ? Double.NaN : self.distanceTo(player.position());
            if (self != null && (Double.isNaN(distance) || distance > filters.range)) continue;

            TargetCategory category = entry == null ? TargetCategory.TEMPORARY : entry.category();
            int priority = entry == null ? DEFAULT_PRIORITY : entry.priority();
            candidates.add(new TargetCandidate(player, entry, distance, priority, category));
        }

        candidates.sort(comparator(sort));
        if (maxCandidates > 0 && candidates.size() > maxCandidates) {
            return new ArrayList<>(candidates.subList(0, maxCandidates));
        }
        return candidates;
    }

    public static boolean passes(PlayerSnapshot player, TargetEntry entry, TargetFilterSettings filters) {
        if (player == null) return false;

        if (entry != null) {
            if (filters.protectFriends && entry.category() == TargetCategory.FRIEND) return false;
            if (filters.protectIgnored && entry.category() == TargetCategory.IGNORE) return false;
            if (!entry.isSelectable()) return false;
        } else if (filters.onlyTracked) {
            return false;
        }

        if (filters.ignoreNaked && player.armorPoints() <= filters.nakedArmorThreshold) return false;
        if (filters.requireWeapon && !player.holdingWeapon()) return false;
        if (filters.ignoreInvisible && player.invisible()) return false;
        if (filters.ignoreCreative && (player.creative() || player.spectator())) return false;
        return true;
    }

    public static Comparator<TargetCandidate> comparator(SortMode mode) {
        if (mode == null) mode = SortMode.PRIORITY;
        return switch (mode) {
            case PRIORITY -> Comparator.comparingDouble(TargetCandidate::score);
            case DISTANCE -> Comparator.comparingDouble(c -> Double.isNaN(c.distance) ? Double.MAX_VALUE : c.distance);
            case HEALTH -> Comparator.comparingDouble(c -> c.snapshot.health());
            case RECENCY -> Comparator.comparingLong((TargetCandidate c) -> c.snapshot.timestamp()).reversed();
        };
    }
}
