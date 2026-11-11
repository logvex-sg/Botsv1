package com.logvex.hunter.core.stats;

import java.util.HashMap;
import java.util.Map;

/**
 * Decides when a player that vanished was actually killed by the local player.
 *
 * <p>This is the honest middle ground the addon promised: it never invents a kill, and it never
 * claims one just because a player walked out of range. A disappearance only counts when the local
 * player struck that player recently <em>and</em> the last health we saw was low, which is the
 * evidence a controlled-session elimination actually leaves behind. Everything is keyed by the
 * player's identity, so two players with the same name are not confused.
 *
 * <p>Minecraft-free and unit-testable: the game layer feeds it attacks, health observations and
 * disappearances, and it answers whether a disappearance should be recorded as a kill.
 */
public final class EliminationLog {
    /** How recently the local player must have struck a player for a disappearance to count. */
    public static final long DEFAULT_WINDOW_MS = 8_000;
    /** At or below this health (in half-hearts) a struck player's disappearance counts as a kill. */
    public static final double DEFAULT_KILL_HEALTH = 6.0;

    private final long windowMs;
    private final double killHealth;
    private final Map<String, Record> records = new HashMap<>();

    public EliminationLog() {
        this(DEFAULT_WINDOW_MS, DEFAULT_KILL_HEALTH);
    }

    public EliminationLog(long windowMs, double killHealth) {
        this.windowMs = Math.max(0, windowMs);
        this.killHealth = Math.max(0, killHealth);
    }

    /** What the log remembers about one player. */
    private static final class Record {
        long lastAttackedAt = Long.MIN_VALUE;
        double lastHealth = -1;
        String name = "";
    }

    private Record record(String key) {
        return records.computeIfAbsent(key, k -> new Record());
    }

    /** Records that the local player struck the given player at {@code now}. */
    public void noteAttack(String key, String name, long now) {
        if (key == null) return;
        Record record = record(key);
        record.lastAttackedAt = now;
        if (name != null && !name.isBlank()) record.name = name;
    }

    /** Records the most recent health observed for a player (half-hearts). */
    public void noteHealth(String key, double health, long now) {
        if (key == null) return;
        record(key).lastHealth = health;
    }

    /**
     * Whether a player that just left view was killed by the local player, consuming the evidence
     * when it counts so the same disappearance is never recorded twice.
     *
     * @param key the player's identity key
     * @param now the current time
     * @return true when the disappearance is a confirmed elimination
     */
    public boolean confirm(String key, long now) {
        if (key == null) return false;
        Record record = records.remove(key);
        if (record == null) return false;
        if (record.lastAttackedAt == Long.MIN_VALUE) return false;
        boolean inWindow = now - record.lastAttackedAt <= windowMs;
        boolean wasLow = record.lastHealth >= 0 && record.lastHealth <= killHealth;
        return inWindow && wasLow;
    }

    /** Forgets everything about a player (e.g. they were removed from the target lists). */
    public void forget(String key) {
        if (key != null) records.remove(key);
    }

    public void clear() {
        records.clear();
    }

    /** The number of players currently carrying attack evidence. */
    public int trackedCount() {
        return records.size();
    }
}
