package com.logvex.worker.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/**
 * Small GSON facade.
 *
 * <p>Every parse path here is defensive: a malformed line from the network returns {@code null}
 * rather than throwing, because a worker must never die on bad input.
 */
public final class Json {
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    private Json() {}

    public static Gson gson() {
        return GSON;
    }

    public static String write(Object value) {
        return GSON.toJson(value);
    }

    public static JsonObject parseObject(String text) {
        if (text == null || text.isEmpty()) return null;
        try {
            JsonElement element = JsonParser.parseString(text);
            return element.isJsonObject() ? element.getAsJsonObject() : null;
        } catch (RuntimeException ex) {
            return null;
        }
    }

    public static String string(JsonObject object, String key, String fallback) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull()) return fallback;
        try {
            return object.get(key).getAsString();
        } catch (RuntimeException ex) {
            return fallback;
        }
    }

    public static int integer(JsonObject object, String key, int fallback) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull()) return fallback;
        try {
            return object.get(key).getAsInt();
        } catch (RuntimeException ex) {
            return fallback;
        }
    }

    public static boolean bool(JsonObject object, String key, boolean fallback) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull()) return fallback;
        try {
            return object.get(key).getAsBoolean();
        } catch (RuntimeException ex) {
            return fallback;
        }
    }

    public static double number(JsonObject object, String key, double fallback) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull()) return fallback;
        try {
            return object.get(key).getAsDouble();
        } catch (RuntimeException ex) {
            return fallback;
        }
    }
}
