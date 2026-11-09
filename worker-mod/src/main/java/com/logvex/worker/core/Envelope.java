package com.logvex.worker.core;

import com.google.gson.JsonObject;

/**
 * One protocol message: a type, a correlation id and a free-form payload.
 *
 * <p>The same shape travels in both directions so the reader on either side has one code path. An
 * unknown type is ignored by the receiver rather than treated as an error, which keeps an older
 * worker usable with a newer host.
 */
public final class Envelope {
    public int v = Protocol.VERSION;
    public String type;
    public String id;
    public JsonObject payload;

    public Envelope() {}

    public Envelope(String type, String id, JsonObject payload) {
        this.type = type;
        this.id = id;
        this.payload = payload == null ? new JsonObject() : payload;
    }

    public static Envelope of(String type, JsonObject payload) {
        return new Envelope(type, null, payload);
    }

    public static Envelope reply(String type, String correlationId, JsonObject payload) {
        return new Envelope(type, correlationId, payload);
    }

    public JsonObject payloadOrEmpty() {
        return payload == null ? new JsonObject() : payload;
    }

    public String encode() {
        return Json.write(this);
    }

    /** Parses a raw frame. Returns {@code null} when it is not a well-formed envelope. */
    public static Envelope decode(String text) {
        JsonObject root = Json.parseObject(text);
        if (root == null) return null;
        String type = Json.string(root, "type", null);
        if (type == null || type.isBlank()) return null;
        Envelope envelope = new Envelope();
        envelope.v = Json.integer(root, "v", Protocol.VERSION);
        envelope.type = type;
        envelope.id = Json.string(root, "id", null);
        if (root.has("payload") && root.get("payload").isJsonObject()) {
            envelope.payload = root.getAsJsonObject("payload");
        } else {
            envelope.payload = new JsonObject();
        }
        return envelope;
    }
}
