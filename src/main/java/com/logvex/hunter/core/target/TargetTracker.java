package com.logvex.hunter.core.target;

import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.model.Vec3;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Tracks which players are visible, detects changes, and owns the current target.
 *
 * <p>Kept Minecraft-free so the change detection and switching rules are unit-tested directly.
 * The tracker is session-scoped: {@link #reset()} is called when the world changes or the player
 * disconnects.
 */
public final class TargetTracker {
    /** A player became visible (or visible again). */
    public record Appearance(PlayerSnapshot snapshot, TargetEntry entry, double distance, boolean reappeared, long awayMillis) {}

    /** A player left the detection range. */
    public record Disappearance(PlayerSnapshot snapshot, TargetEntry entry, long lastSeen) {}

    /** A visible player moved inside the "close range" radius. */
    public record EnteredRange(PlayerSnapshot snapshot, TargetEntry entry, double distance) {}

    public record ScanResult(List<TargetCandidate> candidates,
                             List<Appearance> appeared,
                             List<Disappearance> disappeared,
                             List<EnteredRange> enteredRange,
                             TargetCandidate current,
                             boolean switched) {
        public boolean hasChanges() {
            return !appeared.isEmpty() || !disappeared.isEmpty() || !enteredRange.isEmpty() || switched;
        }
    }

    private final Map<String, PlayerSnapshot> visible = new LinkedHashMap<>();
    private final Map<String, Double> previousDistances = new LinkedHashMap<>();
    private final Set<String> everSeen = new LinkedHashSet<>();
    private String currentKey;
    private long lastSwitchAt;
    private double closeRange = 16;

    public void setCloseRange(double closeRange) {
        this.closeRange = Math.max(1, closeRange);
    }

    public double closeRange() {
        return closeRange;
    }

    public ScanResult update(Vec3 self, List<PlayerSnapshot> players, TargetStore store, TargetFilterSettings filters,
                             SortMode sort, int maxCandidates, boolean autoSelect, int switchCooldownMillis, long now) {
        Map<String, PlayerSnapshot> current = new LinkedHashMap<>();
        if (players != null) {
            for (PlayerSnapshot player : players) {
                if (player != null) current.put(player.identityKey(), player);
            }
        }

        List<Appearance> appeared = new ArrayList<>();
        List<Disappearance> disappeared = new ArrayList<>();

        for (Map.Entry<String, PlayerSnapshot> entry : current.entrySet()) {
            String key = entry.getKey();
            if (visible.containsKey(key)) continue;
            PlayerSnapshot snapshot = entry.getValue();
            TargetEntry tracked = store.find(snapshot.uuid(), snapshot.name());
            double distance = self == null ? Double.NaN : self.distanceTo(snapshot.position());
            boolean reappeared = everSeen.contains(key);
            long away = 0;
            if (reappeared && tracked != null && tracked.lastSeen() > 0) {
                away = Math.max(0, now - tracked.lastSeen());
            }
            appeared.add(new Appearance(snapshot, tracked, distance, reappeared, away));
            everSeen.add(key);
        }

        for (Map.Entry<String, PlayerSnapshot> entry : visible.entrySet()) {
            if (current.containsKey(entry.getKey())) continue;
            PlayerSnapshot snapshot = entry.getValue();
            TargetEntry tracked = store.find(snapshot.uuid(), snapshot.name());
            long lastSeen = tracked != null && tracked.lastSeen() > 0 ? tracked.lastSeen() : now;
            disappeared.add(new Disappearance(snapshot, tracked, lastSeen));
        }

        List<TargetCandidate> candidates = TargetSelector.select(self, new ArrayList<>(current.values()), store, filters, sort, maxCandidates);

        List<EnteredRange> entered = new ArrayList<>();
        Map<String, Double> distances = new LinkedHashMap<>();
        for (TargetCandidate candidate : candidates) {
            String key = candidate.snapshot.identityKey();
            distances.put(key, candidate.distance);
            Double previous = previousDistances.get(key);
            if (!Double.isNaN(candidate.distance) && candidate.distance <= closeRange
                && (previous == null || previous > closeRange)) {
                entered.add(new EnteredRange(candidate.snapshot, candidate.entry, candidate.distance));
            }
        }

        visible.clear();
        visible.putAll(current);
        previousDistances.clear();
        previousDistances.putAll(distances);

        TargetCandidate currentTarget = findCandidate(candidates, currentKey);
        boolean switched = false;

        if (autoSelect) {
            TargetCandidate best = candidates.isEmpty() ? null : candidates.get(0);
            boolean cooldownElapsed = now - lastSwitchAt >= Math.max(0, switchCooldownMillis);
            if (best == null) {
                if (currentTarget != null) {
                    currentKey = null;
                    currentTarget = null;
                    switched = true;
                    lastSwitchAt = now;
                }
            } else if (currentTarget == null) {
                currentKey = best.snapshot.identityKey();
                currentTarget = best;
                switched = true;
                lastSwitchAt = now;
            } else if (cooldownElapsed && !best.snapshot.identityKey().equals(currentTarget.snapshot.identityKey())
                       && better(best, currentTarget, sort)) {
                currentKey = best.snapshot.identityKey();
                currentTarget = best;
                switched = true;
                lastSwitchAt = now;
            }
        } else if (currentTarget == null) {
            currentKey = null;
        }

        return new ScanResult(candidates, appeared, disappeared, entered, currentTarget, switched);
    }

    private boolean better(TargetCandidate candidate, TargetCandidate current, SortMode sort) {
        int comparison = TargetSelector.comparator(sort).compare(candidate, current);
        if (comparison != 0) return comparison < 0;
        return candidate.distance < current.distance;
    }

    private TargetCandidate findCandidate(List<TargetCandidate> candidates, String key) {
        if (key == null) return null;
        for (TargetCandidate candidate : candidates) {
            if (candidate.snapshot.identityKey().equals(key)) return candidate;
        }
        return null;
    }

    /** Selects a specific visible player as the target. Returns the candidate, or null if not visible. */
    public TargetCandidate select(String identityKey, List<TargetCandidate> candidates, long now) {
        TargetCandidate candidate = findCandidate(candidates, identityKey);
        if (candidate == null) return null;
        currentKey = identityKey;
        lastSwitchAt = now;
        return candidate;
    }

    public void clearSelection() {
        currentKey = null;
    }

    public String currentKey() {
        return currentKey;
    }

    public void forceSwitchAllowed() {
        lastSwitchAt = 0;
    }

    public boolean isVisible(String identityKey) {
        return visible.containsKey(identityKey);
    }

    public PlayerSnapshot visiblePlayer(String identityKey) {
        return visible.get(identityKey);
    }

    public int visibleCount() {
        return visible.size();
    }

    public List<PlayerSnapshot> visiblePlayers() {
        return new ArrayList<>(visible.values());
    }

    public boolean everSeen(String identityKey) {
        return everSeen.contains(identityKey);
    }

    public int everSeenCount() {
        return everSeen.size();
    }

    public void reset() {
        visible.clear();
        previousDistances.clear();
        everSeen.clear();
        currentKey = null;
        lastSwitchAt = 0;
    }

    /** Keeps the identity set but forgets visibility, e.g. after a dimension change. */
    public void resetVisibility() {
        visible.clear();
        previousDistances.clear();
        currentKey = null;
    }
}
