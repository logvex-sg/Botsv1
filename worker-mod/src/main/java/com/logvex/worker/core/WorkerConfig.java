package com.logvex.worker.core;

import com.google.gson.JsonObject;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Worker configuration, read from {@code config/logvex-worker.json}.
 *
 * <p>Everything has a usable default so the mod can be dropped into a mods folder and work with no
 * hand-editing. The file only has to exist when the host is not on the default address.
 */
public final class WorkerConfig {
    public static final String DEFAULT_HOST = "127.0.0.1";
    /** Must match the Fleet Manager's default worker-server port (Settings -> Worker server). */
    public static final int DEFAULT_PORT = 8721;

    public String host = DEFAULT_HOST;
    public int port = DEFAULT_PORT;
    public String token = "";
    /** Optional stable id; when blank the worker derives one from its Minecraft account. */
    public String workerId = "";
    public String label = "";
    /** Optional group name the host can pre-assign; purely informational, the host is authoritative. */
    public String group = "";
    public int heartbeatSeconds = 5;
    public int reconnectSeconds = 5;
    public boolean enabled = true;

    // Task permissions. Read-only tasks always run; these gate the mutating kinds so an operator can
    // hand a worker to a host without letting it move items, fly, or type on their behalf.
    public boolean allowCommands = true;
    public boolean allowChat = true;
    public boolean allowRegear = true;
    public boolean allowEfly = true;

    public static WorkerConfig defaults() {
        return new WorkerConfig();
    }

    /** Whether the given mutating task kind is permitted by this configuration. */
    public boolean permits(String kind) {
        if (kind == null) return false;
        return switch (kind.toLowerCase(java.util.Locale.ROOT)) {
            case Protocol.TASK_COMMAND -> allowCommands;
            case Protocol.TASK_CHAT -> allowChat;
            case Protocol.TASK_REGEAR -> allowRegear;
            case Protocol.TASK_EFLY -> allowEfly;
            default -> true;
        };
    }

    /** Loads the config, returning defaults when the file is missing or unreadable. */
    public static WorkerConfig load(Path file) {
        WorkerConfig config = defaults();
        try {
            if (!Files.exists(file)) {
                save(file, config);
                return config;
            }
            JsonObject root = Json.parseObject(Files.readString(file));
            if (root == null) return config;
            config.host = Json.string(root, "host", config.host);
            config.port = Json.integer(root, "port", config.port);
            config.token = Json.string(root, "token", config.token);
            config.workerId = Json.string(root, "workerId", config.workerId);
            config.label = Json.string(root, "label", config.label);
            config.group = Json.string(root, "group", config.group);
            config.heartbeatSeconds = Math.max(1, Json.integer(root, "heartbeatSeconds", config.heartbeatSeconds));
            config.reconnectSeconds = Math.max(1, Json.integer(root, "reconnectSeconds", config.reconnectSeconds));
            config.enabled = Json.bool(root, "enabled", config.enabled);
            config.allowCommands = Json.bool(root, "allowCommands", config.allowCommands);
            config.allowChat = Json.bool(root, "allowChat", config.allowChat);
            config.allowRegear = Json.bool(root, "allowRegear", config.allowRegear);
            config.allowEfly = Json.bool(root, "allowEfly", config.allowEfly);
            return config;
        } catch (Exception ex) {
            // A corrupt or unreadable file must not stop the worker from starting.
            return config;
        }
    }

    public static void save(Path file, WorkerConfig config) {
        try {
            Files.createDirectories(file.getParent());
            Files.writeString(file, Json.gson().toJson(config));
        } catch (Exception ignored) {
            // Persisting is best-effort; the in-memory config still applies this session.
        }
    }

    public String endpoint() {
        return host + ":" + port;
    }
}
