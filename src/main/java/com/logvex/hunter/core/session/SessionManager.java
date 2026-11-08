package com.logvex.hunter.core.session;

import com.logvex.hunter.core.stats.SessionRecord;

import java.util.UUID;

/**
 * Owns the current session and the per-target histories.
 *
 * <p>Starting a session stamps the start time and opens a {@link SessionRecord}; stopping it closes
 * the record so it can be stored in the statistics history.
 */
public final class SessionManager {
    private SessionRecord current;
    private long lastActivity;
    private int historyEntries = 50;
    private final java.util.Map<String, TargetHistory> histories = new java.util.LinkedHashMap<>();

    public boolean isActive() {
        return current != null && current.isOpen();
    }

    public SessionRecord current() {
        return current;
    }

    public long lastActivity() {
        return lastActivity;
    }

    public int historyEntries() {
        return historyEntries;
    }

    public void setHistoryEntries(int historyEntries) {
        this.historyEntries = Math.max(1, Math.min(500, historyEntries));
    }

    public SessionRecord start(String id, long timestamp, String server, String dimension) {
        if (isActive()) stop(timestamp);
        current = new SessionRecord(id, timestamp);
        current.server = server == null ? "" : server;
        current.dimension = dimension == null ? "" : dimension;
        lastActivity = timestamp;
        return current;
    }

    public SessionRecord stop(long timestamp) {
        if (current == null) return null;
        if (current.isOpen()) current.close(timestamp);
        SessionRecord closed = current;
        current = null;
        return closed;
    }

    public void touch(long timestamp) {
        lastActivity = timestamp;
    }

    public TargetHistory history(UUID uuid, String name) {
        String key = TargetHistory.key(uuid, name);
        TargetHistory history = histories.get(key);
        if (history == null) {
            history = new TargetHistory(uuid == null ? "" : uuid.toString(), name, historyEntries);
            histories.put(key, history);
        }
        return history;
    }

    public TargetHistory findHistory(UUID uuid, String name) {
        return histories.get(TargetHistory.key(uuid, name));
    }

    public java.util.Collection<TargetHistory> allHistories() {
        return histories.values();
    }

    public int historyCount() {
        return histories.size();
    }

    /** Drops histories that have not been seen for the given age. */
    public int prune(long now, long maxAgeMillis) {
        int removed = 0;
        java.util.Iterator<java.util.Map.Entry<String, TargetHistory>> it = histories.entrySet().iterator();
        while (it.hasNext()) {
            TargetHistory history = it.next().getValue();
            if (history.lastSeen() > 0 && now - history.lastSeen() > maxAgeMillis) {
                it.remove();
                removed++;
            }
        }
        return removed;
    }

    public void clearHistories() {
        histories.clear();
    }

    public void reset() {
        current = null;
        histories.clear();
        lastActivity = 0;
    }
}
