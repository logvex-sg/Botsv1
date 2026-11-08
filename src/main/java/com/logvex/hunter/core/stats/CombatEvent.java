package com.logvex.hunter.core.stats;

import com.logvex.hunter.core.util.Json;
import com.logvex.hunter.core.util.Time;

import java.util.Map;

/** A timestamped line for the dashboard's "recent events" panel. */
public final class CombatEvent {
    public enum Kind {
        KILL("kill"),
        DEATH("death"),
        ENCOUNTER("encounter"),
        TARGET_SWITCH("target-switch"),
        TARGET_LOST("target-lost"),
        TARGET_FOUND("target-found"),
        MODULE("module"),
        STASIS("stasis"),
        CONNECTION("connection"),
        INFO("info");

        private final String key;

        Kind(String key) {
            this.key = key;
        }

        public String key() {
            return key;
        }

        public static Kind fromKey(String key) {
            if (key == null) return INFO;
            for (Kind kind : values()) {
                if (kind.key.equalsIgnoreCase(key)) return kind;
            }
            return INFO;
        }
    }

    public final long timestamp;
    public final Kind kind;
    public final String message;
    public final String detail;

    public CombatEvent(long timestamp, Kind kind, String message, String detail) {
        this.timestamp = timestamp;
        this.kind = kind == null ? Kind.INFO : kind;
        this.message = message == null ? "" : message;
        this.detail = detail == null ? "" : detail;
    }

    public static CombatEvent now(Kind kind, String message, String detail) {
        return new CombatEvent(System.currentTimeMillis(), kind, message, detail);
    }

    public String display() {
        return Time.clock(timestamp) + "  " + message;
    }

    public Map<String, Object> toJson() {
        Map<String, Object> map = Json.object();
        map.put("timestamp", timestamp);
        map.put("kind", kind.key());
        map.put("message", message);
        if (!detail.isBlank()) map.put("detail", detail);
        return map;
    }

    public static CombatEvent fromJson(Map<String, Object> map) {
        return new CombatEvent(
            Json.getLong(map, "timestamp", 0),
            Kind.fromKey(Json.getString(map, "kind", "info")),
            Json.getString(map, "message", ""),
            Json.getString(map, "detail", ""));
    }
}
