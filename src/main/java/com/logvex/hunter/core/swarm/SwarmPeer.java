package com.logvex.hunter.core.swarm;

import com.logvex.hunter.core.util.Json;

import java.util.Map;

/**
 * The live state of one connected swarm worker, as seen by the host.
 *
 * <p>Only ever mutated from the host's connection threads and read from the GUI thread; every
 * mutable field is therefore {@code volatile} so a repaint never sees a torn value. Nothing here
 * references Minecraft, so a roster can be driven by a test without a game.
 */
public final class SwarmPeer {
    private final String id;
    private final String address;
    private volatile String label;
    private volatile String role = "worker";
    private volatile String status = "unknown";
    private volatile String lastResult = "";
    private volatile long connectedAt;
    private volatile long lastSeen;
    private volatile long lastLatencyMillis = -1;
    private volatile long commandsSent;
    private volatile long resultsReceived;
    private volatile boolean alive = true;

    public SwarmPeer(String id, String address, String label) {
        this.id = id;
        this.address = address == null ? "" : address;
        this.label = label == null || label.isBlank() ? id : label;
    }

    public String id() {
        return id;
    }

    public String address() {
        return address;
    }

    public String label() {
        return label;
    }

    public void setLabel(String label) {
        if (label != null && !label.isBlank()) this.label = label;
    }

    public String role() {
        return role;
    }

    public void setRole(String role) {
        this.role = role == null || role.isBlank() ? "worker" : role;
    }

    public String status() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status == null ? "unknown" : status;
    }

    public String lastResult() {
        return lastResult;
    }

    public void setLastResult(String lastResult) {
        this.lastResult = lastResult == null ? "" : lastResult;
    }

    public long connectedAt() {
        return connectedAt;
    }

    public void setConnectedAt(long connectedAt) {
        this.connectedAt = connectedAt;
    }

    public long lastSeen() {
        return lastSeen;
    }

    public void touch(long timestamp) {
        this.lastSeen = timestamp;
    }

    public long lastLatencyMillis() {
        return lastLatencyMillis;
    }

    public void setLastLatencyMillis(long lastLatencyMillis) {
        this.lastLatencyMillis = lastLatencyMillis;
    }

    public long commandsSent() {
        return commandsSent;
    }

    public void incrementCommandsSent() {
        this.commandsSent++;
    }

    public long resultsReceived() {
        return resultsReceived;
    }

    public void incrementResultsReceived() {
        this.resultsReceived++;
    }

    public boolean alive() {
        return alive;
    }

    public void markDead() {
        this.alive = false;
    }

    /** Whether a reply arrived recently enough that the peer should still be shown as live. */
    public boolean stale(long now, long timeoutMillis) {
        return lastSeen > 0 && now - lastSeen > timeoutMillis;
    }

    public Map<String, Object> toJson() {
        Map<String, Object> map = Json.object();
        map.put("id", id);
        map.put("label", label);
        map.put("address", address);
        map.put("role", role);
        map.put("status", status);
        map.put("alive", alive);
        map.put("connectedAt", connectedAt);
        map.put("lastSeen", lastSeen);
        map.put("latency", lastLatencyMillis);
        map.put("commandsSent", commandsSent);
        map.put("resultsReceived", resultsReceived);
        if (!lastResult.isBlank()) map.put("lastResult", lastResult);
        return map;
    }

    @Override
    public String toString() {
        return label + " (" + address + ")";
    }
}
