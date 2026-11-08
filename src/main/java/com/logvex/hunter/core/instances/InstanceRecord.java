package com.logvex.hunter.core.instances;

import com.logvex.hunter.core.util.Json;

import java.util.Map;

/**
 * The registered description of a client instance.
 *
 * <p>Instances are explicit: a registration records the name, the address of the instance's own
 * endpoint and the shared secret used to authenticate. Nothing here reaches into another client's
 * world state directly.
 */
public final class InstanceRecord {
    private String id;
    private String label;
    private String host = "127.0.0.1";
    private int port;
    private String token = "";
    private InstanceTransport transport = InstanceTransport.READ_ONLY;
    private boolean enabled = true;
    private String accountName = "";
    private String notes = "";

    // live state (not persisted)
    private InstanceStatus status = InstanceStatus.UNKNOWN;
    private long lastSeen;
    private long lastLatencyMillis = -1;
    private String lastError = "";
    private Map<String, Object> lastStats = Json.object();

    public InstanceRecord(String id, String label) {
        this.id = id;
        this.label = label;
    }

    public String id() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String label() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public String host() {
        return host;
    }

    public void setHost(String host) {
        this.host = host == null || host.isBlank() ? "127.0.0.1" : host;
    }

    public int port() {
        return port;
    }

    public void setPort(int port) {
        this.port = Math.max(0, Math.min(65535, port));
    }

    public String token() {
        return token;
    }

    public void setToken(String token) {
        this.token = token == null ? "" : token;
    }

    public InstanceTransport transport() {
        return transport;
    }

    public void setTransport(InstanceTransport transport) {
        this.transport = transport == null ? InstanceTransport.READ_ONLY : transport;
    }

    public boolean enabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String accountName() {
        return accountName;
    }

    public void setAccountName(String accountName) {
        this.accountName = accountName == null ? "" : accountName;
    }

    public String notes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes == null ? "" : notes;
    }

    public String endpoint() {
        return host + ":" + port;
    }

    public boolean canSendCommands() {
        return enabled && transport == InstanceTransport.HTTP && !token.isBlank() && port > 0;
    }

    // ------------------------------------------------------------- live state

    public InstanceStatus status() {
        return status;
    }

    public void setStatus(InstanceStatus status) {
        this.status = status == null ? InstanceStatus.UNKNOWN : status;
    }

    public long lastSeen() {
        return lastSeen;
    }

    public void setLastSeen(long lastSeen) {
        this.lastSeen = lastSeen;
    }

    public long lastLatencyMillis() {
        return lastLatencyMillis;
    }

    public void setLastLatencyMillis(long lastLatencyMillis) {
        this.lastLatencyMillis = lastLatencyMillis;
    }

    public String lastError() {
        return lastError;
    }

    public void setLastError(String lastError) {
        this.lastError = lastError == null ? "" : lastError;
    }

    public Map<String, Object> lastStats() {
        return lastStats;
    }

    public void setLastStats(Map<String, Object> lastStats) {
        this.lastStats = lastStats == null ? Json.object() : lastStats;
    }

    public void markOnline(long timestamp, long latencyMillis) {
        this.status = InstanceStatus.ONLINE;
        this.lastSeen = timestamp;
        this.lastLatencyMillis = latencyMillis;
        this.lastError = "";
    }

    public void markOffline(long timestamp, String error) {
        this.status = enabled ? InstanceStatus.OFFLINE : InstanceStatus.DISABLED;
        this.lastSeen = timestamp;
        this.lastLatencyMillis = -1;
        this.lastError = error == null ? "" : error;
    }

    // ----------------------------------------------------------- persistence

    public Map<String, Object> toJson() {
        Map<String, Object> map = Json.object();
        map.put("id", id);
        map.put("label", label);
        map.put("host", host);
        map.put("port", port);
        map.put("token", token);
        map.put("transport", transport.key());
        map.put("enabled", enabled);
        if (!accountName.isBlank()) map.put("account", accountName);
        if (!notes.isBlank()) map.put("notes", notes);
        return map;
    }

    public static InstanceRecord fromJson(Map<String, Object> map) {
        InstanceRecord record = new InstanceRecord(
            Json.getString(map, "id", "instance"),
            Json.getString(map, "label", "Instance"));
        record.setHost(Json.getString(map, "host", "127.0.0.1"));
        record.setPort(Json.getInt(map, "port", 0));
        record.setToken(Json.getString(map, "token", ""));
        record.setTransport(InstanceTransport.fromKey(Json.getString(map, "transport", "read-only")));
        record.setEnabled(Json.getBoolean(map, "enabled", true));
        record.setAccountName(Json.getString(map, "account", ""));
        record.setNotes(Json.getString(map, "notes", ""));
        if (!record.enabled()) record.status = InstanceStatus.DISABLED;
        return record;
    }

    @Override
    public String toString() {
        return label + " (" + endpoint() + ")";
    }
}
