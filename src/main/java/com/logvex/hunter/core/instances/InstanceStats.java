package com.logvex.hunter.core.instances;

import com.logvex.hunter.core.util.Json;
import com.logvex.hunter.core.util.Text;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The read-only statistics one instance publishes to the others.
 *
 * <p>This is the only kind of data that crosses an instance boundary. It is deliberately a small,
 * plain value object: the central dashboard can show another instance's counters without ever
 * touching its world state.
 */
public final class InstanceStats {
    public final String instanceId;
    public final String instanceLabel;
    public final long timestamp;
    public final String server;
    public final int kills;
    public final int deaths;
    public final int trackedTargets;
    public final double health;
    public final int armorPoints;
    public final int totems;
    public final boolean connected;
    public final String status;
    public final int activeModules;

    public InstanceStats(String instanceId, String instanceLabel, long timestamp, String server,
                         int kills, int deaths, int trackedTargets, double health, int armorPoints,
                         int totems, boolean connected, String status, int activeModules) {
        this.instanceId = instanceId;
        this.instanceLabel = instanceLabel;
        this.timestamp = timestamp;
        this.server = server == null ? "" : server;
        this.kills = kills;
        this.deaths = deaths;
        this.trackedTargets = trackedTargets;
        this.health = health;
        this.armorPoints = armorPoints;
        this.totems = totems;
        this.connected = connected;
        this.status = status == null ? "" : status;
        this.activeModules = activeModules;
    }

    public Map<String, Object> toJson() {
        Map<String, Object> map = Json.object();
        map.put("instanceId", instanceId);
        map.put("instanceLabel", instanceLabel);
        map.put("timestamp", timestamp);
        map.put("server", server);
        map.put("kills", kills);
        map.put("deaths", deaths);
        map.put("trackedTargets", trackedTargets);
        map.put("health", health);
        map.put("armorPoints", armorPoints);
        map.put("totems", totems);
        map.put("connected", connected);
        map.put("status", status);
        map.put("activeModules", activeModules);
        return map;
    }

    public static InstanceStats fromJson(Map<String, Object> map) {
        return new InstanceStats(
            Json.getString(map, "instanceId", ""),
            Json.getString(map, "instanceLabel", ""),
            Json.getLong(map, "timestamp", 0),
            Json.getString(map, "server", ""),
            Json.getInt(map, "kills", 0),
            Json.getInt(map, "deaths", 0),
            Json.getInt(map, "trackedTargets", 0),
            Json.getDouble(map, "health", 0),
            Json.getInt(map, "armorPoints", 0),
            Json.getInt(map, "totems", 0),
            Json.getBoolean(map, "connected", false),
            Json.getString(map, "status", ""),
            Json.getInt(map, "activeModules", 0));
    }

    public String toJsonText() {
        return Json.write(toJson());
    }

    public static InstanceStats fromJsonText(String text) {
        return fromJson(Json.parseObject(text));
    }

    public static String csvHeader() {
        return "instanceId,instanceLabel,timestamp,server,kills,deaths,trackedTargets,health,armorPoints,totems,connected,status,activeModules";
    }

    public String toCsv() {
        return Text.csvRow(instanceId, instanceLabel, timestamp, server, kills, deaths, trackedTargets,
            health, armorPoints, totems, connected, status, activeModules);
    }

    public static String csv(List<InstanceStats> stats) {
        StringBuilder sb = new StringBuilder();
        sb.append(csvHeader()).append('\n');
        for (InstanceStats s : stats) sb.append(s.toCsv()).append('\n');
        return sb.toString();
    }

    /** Parses the JSON body returned by another instance's status endpoint. */
    @SuppressWarnings("unchecked")
    public static InstanceStats parseResponse(String body) {
        Object parsed = Json.parse(body);
        if (parsed instanceof Map<?, ?> map) {
            return fromJson((Map<String, Object>) map);
        }
        throw new Json.JsonException("instance status response must be a JSON object");
    }

    public List<String> summaryLines() {
        List<String> lines = new ArrayList<>();
        lines.add("Instance: " + (instanceLabel.isBlank() ? instanceId : instanceLabel));
        lines.add("Server: " + (server.isBlank() ? "unknown" : server));
        lines.add("Health: " + String.format(java.util.Locale.ROOT, "%.1f", health) + "  Armor: " + armorPoints);
        lines.add("Totems: " + totems + "  Modules: " + activeModules);
        lines.add("Kills: " + kills + "  Deaths: " + deaths + "  Targets: " + trackedTargets);
        lines.add("Connected: " + connected + "  Status: " + status);
        return lines;
    }

    public Map<String, Object> asMap() {
        return new LinkedHashMap<>(toJson());
    }
}
