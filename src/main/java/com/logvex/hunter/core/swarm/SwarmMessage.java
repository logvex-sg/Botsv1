package com.logvex.hunter.core.swarm;

import com.logvex.hunter.core.util.Json;

import java.util.Map;

/**
 * One line of the swarm protocol.
 *
 * <p>A message is a thin wrapper over a JSON object so the encoding and decoding stay in one place.
 * Encoding never emits a newline (the transport frames on lines), and decoding rejects anything that
 * is not a JSON object so a stray byte from a socket cannot crash a worker.
 */
public final class SwarmMessage {
    private final Map<String, Object> data;

    private SwarmMessage(Map<String, Object> data) {
        this.data = data;
    }

    public static SwarmMessage of(String type) {
        Map<String, Object> map = Json.object();
        map.put(SwarmProtocol.FIELD_TYPE, type);
        return new SwarmMessage(map);
    }

    public SwarmMessage with(String key, Object value) {
        if (value != null) data.put(key, value);
        return this;
    }

    public String type() {
        return Json.getString(data, SwarmProtocol.FIELD_TYPE, "");
    }

    public String string(String key) {
        return Json.getString(data, key, "");
    }

    public long number(String key, long fallback) {
        return Json.getLong(data, key, fallback);
    }

    public boolean flag(String key) {
        return Json.getBoolean(data, key, false);
    }

    public Map<String, Object> raw() {
        return data;
    }

    /** Serialises to one compact JSON line with no trailing newline. */
    public String encode() {
        return Json.write(data);
    }

    /**
     * Parses one line.
     *
     * @return the message, or {@code null} when the line is blank, oversized or not a JSON object.
     */
    @SuppressWarnings("unchecked")
    public static SwarmMessage decode(String line) {
        if (line == null) return null;
        String trimmed = line.trim();
        if (trimmed.isEmpty() || trimmed.length() > SwarmProtocol.MAX_LINE) return null;
        try {
            Object parsed = Json.parse(trimmed);
            if (!(parsed instanceof Map)) return null;
            return new SwarmMessage((Map<String, Object>) parsed);
        } catch (RuntimeException e) {
            return null;
        }
    }

    @Override
    public String toString() {
        return type() + " " + data;
    }
}
