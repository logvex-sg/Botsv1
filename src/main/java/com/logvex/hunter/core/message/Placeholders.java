package com.logvex.hunter.core.message;

import com.logvex.hunter.core.model.PlayerSnapshot;
import com.logvex.hunter.core.model.TargetEntry;
import com.logvex.hunter.core.model.Vec3;
import com.logvex.hunter.core.util.Time;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/** Builds the placeholder map used by {@link MessageManager}. */
public final class Placeholders {
    private Placeholders() {}

    /**
     * Standard placeholders supported by every message: {@code player}, {@code username},
     * {@code uuid}, {@code distance}, {@code health}, {@code armor}, {@code weapon},
     * {@code server}, {@code coordinates}, {@code category}, {@code priority} and {@code time}.
     */
    public static Map<String, String> build() {
        Map<String, String> values = new LinkedHashMap<>();
        values.put("player", "unknown");
        values.put("username", "unknown");
        values.put("uuid", "");
        values.put("distance", "0");
        values.put("health", "0");
        values.put("armor", "0");
        values.put("weapon", "none");
        values.put("server", "singleplayer");
        values.put("coordinates", "");
        values.put("category", "");
        values.put("priority", "");
        values.put("time", Time.clock(System.currentTimeMillis()));
        return values;
    }

    public static Map<String, String> build(String player, double distance, double health) {
        Map<String, String> values = build();
        values.put("player", player == null ? "unknown" : player);
        values.put("username", player == null ? "unknown" : player);
        values.put("distance", String.format(Locale.ROOT, "%.0f", distance));
        values.put("health", String.format(Locale.ROOT, "%.0f", health));
        return values;
    }

    public static Map<String, String> of(PlayerSnapshot snapshot, TargetEntry entry, double distance, String server) {
        Map<String, String> values = build();
        if (snapshot != null) {
            values.put("player", snapshot.name() == null ? "unknown" : snapshot.name());
            values.put("username", snapshot.name() == null ? "unknown" : snapshot.name());
            values.put("uuid", snapshot.uuid() == null ? "" : snapshot.uuid().toString());
            values.put("distance", String.format(Locale.ROOT, "%.0f", distance));
            values.put("health", String.format(Locale.ROOT, "%.0f", snapshot.health()));
            values.put("armor", String.valueOf(snapshot.armorPoints()));
            values.put("coordinates", snapshot.position() == null ? "" : snapshot.position().shortString());
        }
        if (entry != null) {
            values.put("category", entry.category().displayName());
            values.put("priority", String.valueOf(entry.priority()));
            if (entry.uuid() != null) values.put("uuid", entry.uuid().toString());
        }
        if (server != null && !server.isBlank()) values.put("server", server);
        return values;
    }

    public static Map<String, String> with(Map<String, String> base, String key, String value) {
        base.put(key, value);
        return base;
    }

    public static Map<String, String> coordinates(Vec3 pos) {
        Map<String, String> values = build();
        values.put("coordinates", pos == null ? "" : pos.shortString());
        return values;
    }
}
