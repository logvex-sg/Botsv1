package com.logvex.hunter.core.swarm;

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
    private final String label;
    private volatile String status = "unknown";
    private volatile String lastResult = "";
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

    @Override
    public String toString() {
        return label + " (" + address + ")";
    }
}
