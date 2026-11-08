package com.logvex.hunter.core.session;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.UUID;

/**
 * Per-target sighting history: when the player was last seen, where, and how the encounters went.
 *
 * <p>The history is bounded by {@code maxEntries} so it cannot grow without limit during a long
 * session. A dimension change clears positions, because a stored position is meaningless once the
 * player is in another world.
 */
public final class TargetHistory {
    public static final class Sighting {
        public final long timestamp;
        public final String dimension;
        public final double x;
        public final double y;
        public final double z;
        public final double distance;
        public final double health;

        public Sighting(long timestamp, String dimension, double x, double y, double z, double distance, double health) {
            this.timestamp = timestamp;
            this.dimension = dimension == null ? "" : dimension;
            this.x = x;
            this.y = y;
            this.z = z;
            this.distance = distance;
            this.health = health;
        }

        public String positionString() {
            return String.format(java.util.Locale.ROOT, "%.0f %.0f %.0f", x, y, z);
        }
    }

    public record Encounter(String uuid, long firstSeen, long lastSeen, int sightings, String lastDimension,
                            double lastX, double lastY, double lastZ, int kills, int deaths) {
    }

    private final int maxEntries;
    private final Deque<Sighting> sightings = new ArrayDeque<>();
    private final String uuid;
    private String name;
    private int kills;
    private int deaths;
    private int encounterCount;
    private long firstSeen;
    private long lastSeen;
    private String lastDimension = "";
    private double lastX;
    private double lastY;
    private double lastZ;

    public TargetHistory(String uuid, String name, int maxEntries) {
        this.uuid = uuid == null ? "" : uuid;
        this.name = name;
        this.maxEntries = Math.max(1, maxEntries);
    }

    public void record(long timestamp, String dimension, double x, double y, double z, double distance, double health) {
        if (firstSeen == 0) firstSeen = timestamp;
        lastSeen = timestamp;
        if (dimension != null && !dimension.isBlank()) lastDimension = dimension;
        lastX = x;
        lastY = y;
        lastZ = z;
        sightings.addLast(new Sighting(timestamp, dimension, x, y, z, distance, health));
        while (sightings.size() > maxEntries) sightings.removeFirst();
    }

    /** Called when the player changes dimension; old positions are no longer meaningful. */
    public void onDimensionChange(String dimension) {
        if (dimension != null && !dimension.isBlank() && !dimension.equals(lastDimension)) {
            lastDimension = dimension;
            lastX = 0;
            lastY = 0;
            lastZ = 0;
        }
    }

    public void addKill() {
        kills++;
    }

    public void addDeath() {
        deaths++;
    }

    public void addEncounter() {
        encounterCount++;
    }

    public List<Sighting> sightings() {
        return new ArrayList<>(sightings);
    }

    public int sightingCount() {
        return sightings.size();
    }

    public long firstSeen() {
        return firstSeen;
    }

    public long lastSeen() {
        return lastSeen;
    }

    public String name() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String lastDimension() {
        return lastDimension;
    }

    public double lastX() {
        return lastX;
    }

    public double lastY() {
        return lastY;
    }

    public double lastZ() {
        return lastZ;
    }

    public int kills() {
        return kills;
    }

    public int deaths() {
        return deaths;
    }

    public int encounterCount() {
        return encounterCount;
    }

    public Encounter toEncounter() {
        return new Encounter(uuid, firstSeen, lastSeen, sightings.size(), lastDimension, lastX, lastY, lastZ, kills, deaths);
    }

    /** Average of the last {@code n} recorded distances, or {@code NaN} when none exist. */
    public double averageRecentDistance(int n) {
        if (sightings.isEmpty() || n <= 0) return Double.NaN;
        double total = 0;
        int count = 0;
        java.util.Iterator<Sighting> it = sightings.descendingIterator();
        while (it.hasNext() && count < n) {
            total += it.next().distance;
            count++;
        }
        return count == 0 ? Double.NaN : total / count;
    }

    public static String key(UUID uuid, String name) {
        if (uuid != null) return uuid.toString().toLowerCase(java.util.Locale.ROOT);
        return name == null ? "unknown" : name.toLowerCase(java.util.Locale.ROOT);
    }
}
