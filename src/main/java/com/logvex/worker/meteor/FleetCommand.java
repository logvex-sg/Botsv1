package com.logvex.worker.meteor;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.logvex.worker.core.Protocol;
import com.logvex.worker.core.TaskResult;
import com.logvex.worker.core.WorkerConfig;
import com.logvex.worker.core.WorkerLink;
import com.logvex.worker.core.WorkerSnapshot;
import com.logvex.worker.core.WorkerState;
import com.logvex.worker.mc.MinecraftTaskDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import java.util.List;
import java.util.UUID;
import meteordevelopment.meteorclient.commands.Command;
import net.minecraft.commands.SharedSuggestionProvider;

/**
 * The in-game operator command: {@code .worker <subcommand>}.
 *
 * <p>The command is a thin front end over the one {@link FleetRuntime}, so everything it does the
 * host can do too and both see the same state. It never invents a second configuration: {@code
 * .worker config} prints the loaded config, and the service controls call the same pause/stop paths
 * the host's control messages use.
 *
 * <p>Read-only subcommands are always available. The service controls only change what the worker is
 * allowed to execute; they never fake a result.
 */
public class FleetCommand extends Command {
    public FleetCommand() {
        super("worker", "Controls this Logvex Fleet worker.", "logvex-worker", "fleet");
    }

    @Override
    public void build(LiteralArgumentBuilder<SharedSuggestionProvider> builder) {
        builder.executes(context -> {
            status();
            return SINGLE_SUCCESS;
        });

        builder.then(literal("status").executes(context -> {
            status();
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("config").executes(context -> {
            config();
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("events").executes(context -> {
            events(10);
            return SINGLE_SUCCESS;
        }).then(argument("count", IntegerArgumentType.integer(1, 200)).executes(context -> {
            events(IntegerArgumentType.getInteger(context, "count"));
            return SINGLE_SUCCESS;
        })));

        builder.then(literal("connect").executes(context -> {
            FleetRuntime runtime = runtime();
            if (!runtime.configured()) {
                error("Worker is not configured yet.");
                return SINGLE_SUCCESS;
            }
            runtime.start();
            info("Connecting to %s.", runtime.config().endpoint());
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("disconnect").executes(context -> {
            FleetRuntime runtime = runtime();
            if (runtime.configured()) runtime.stop();
            info("Disconnected.");
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("reconnect").executes(context -> {
            FleetRuntime runtime = runtime();
            if (!runtime.configured()) {
                error("Worker is not configured yet.");
                return SINGLE_SUCCESS;
            }
            runtime.applyConfig();
            info("Reconnecting to %s.", runtime.config().endpoint());
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("pause").executes(context -> {
            WorkerLink link = link();
            if (link == null) {
                error("Worker is not configured yet.");
            } else if (link.pause()) {
                info("Paused: mutating tasks will be refused, read-only tasks still run.");
            } else {
                info("Already paused.");
            }
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("resume").executes(context -> {
            WorkerLink link = link();
            if (link == null) {
                error("Worker is not configured yet.");
            } else if (link.resume()) {
                info("Resumed.");
            } else {
                info("Not paused.");
            }
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("disable").executes(context -> {
            WorkerLink link = link();
            if (link == null) {
                error("Worker is not configured yet.");
            } else if (link.disconnectService()) {
                info("Service stopped; the worker stays connected for control.");
            } else {
                info("Service already stopped.");
            }
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("enable").executes(context -> {
            WorkerLink link = link();
            if (link == null) {
                error("Worker is not configured yet.");
            } else if (link.connectService()) {
                info("Service started.");
            } else {
                info("Service already running.");
            }
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("inventory").executes(context -> {
            inventory();
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("count")
            .then(argument("query", StringArgumentType.greedyString()).executes(context -> {
                count(StringArgumentType.getString(context, "query"));
                return SINGLE_SUCCESS;
            }))
        );

        builder.then(literal("search")
            .then(argument("query", StringArgumentType.greedyString()).executes(context -> {
                search(StringArgumentType.getString(context, "query"));
                return SINGLE_SUCCESS;
            }))
        );

        builder.then(literal("inspect")
            .then(argument("query", StringArgumentType.greedyString()).executes(context -> {
                inspect(StringArgumentType.getString(context, "query"));
                return SINGLE_SUCCESS;
            }))
        );

        builder.then(literal("position").executes(context -> {
            position();
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("equipment").executes(context -> {
            equipment();
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("container")
            .then(argument("x", IntegerArgumentType.integer()).then(argument("y", IntegerArgumentType.integer())
                .then(argument("z", IntegerArgumentType.integer()).executes(context -> {
                    containerRead(
                        IntegerArgumentType.getInteger(context, "x"),
                        IntegerArgumentType.getInteger(context, "y"),
                        IntegerArgumentType.getInteger(context, "z"));
                    return SINGLE_SUCCESS;
                }))))
        );

        builder.then(literal("shulkers").executes(context -> {
            shulkerRead();
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("pack")
            .then(argument("query", StringArgumentType.greedyString()).executes(context -> {
                pack(StringArgumentType.getString(context, "query"));
                return SINGLE_SUCCESS;
            }))
        );

        builder.then(literal("unpack").executes(context -> {
            unpack();
            return SINGLE_SUCCESS;
        }));

        builder.then(literal("restock")
            .then(argument("query", StringArgumentType.greedyString()).executes(context -> {
                restock(StringArgumentType.getString(context, "query"), 64);
                return SINGLE_SUCCESS;
            }))
            .then(argument("query", StringArgumentType.string()).then(argument("limit", IntegerArgumentType.integer(1, 2304)).executes(context -> {
                restock(StringArgumentType.getString(context, "query"), IntegerArgumentType.getInteger(context, "limit"));
                return SINGLE_SUCCESS;
            })))
        );

        builder.then(literal("portals").executes(context -> {
            portalScan("scan", 24);
            return SINGLE_SUCCESS;
        }).then(literal("remove").executes(context -> {
            portalScan("remove", 24);
            return SINGLE_SUCCESS;
        })));
    }

    private void position() {
        TaskResult result = dispatch(Protocol.TASK_POSITION, new JsonObject());
        if (result == null) return;
        if (!result.ok) {
            error("Position failed: %s", result.message);
            return;
        }
        info("Pos: %s %s %s  Dim: %s  Health: %s",
            text(result.data, "x"), text(result.data, "y"), text(result.data, "z"),
            text(result.data, "dimension"), text(result.data, "health"));
    }

    private void equipment() {
        TaskResult result = dispatch(Protocol.TASK_EQUIPMENT, new JsonObject());
        if (result == null) return;
        if (!result.ok) {
            error("Equipment check failed: %s", result.message);
            return;
        }
        info("Armor pieces: %s  Ready: %s", text(result.data, "armorPieces"), text(result.data, "ready"));
    }

    private void containerRead(int x, int y, int z) {
        JsonObject payload = new JsonObject();
        payload.addProperty("x", x);
        payload.addProperty("y", y);
        payload.addProperty("z", z);
        TaskResult result = dispatch(Protocol.TASK_CONTAINER_READ, payload);
        if (result == null) return;
        if (!result.ok) {
            error("Container read failed: %s", result.message);
            return;
        }
        info("%s", result.message);
    }

    private void shulkerRead() {
        TaskResult result = dispatch(Protocol.TASK_SHULKER_READ, new JsonObject());
        if (result == null) return;
        if (!result.ok) {
            error("Shulker read failed: %s", result.message);
            return;
        }
        info("%s", result.message);
    }

    private void pack(String query) {
        if (query == null || query.isBlank()) {
            error("Supply an item query to pack.");
            return;
        }
        TaskResult result = dispatch(Protocol.TASK_SHULKER_PACK, payload(Protocol.FIELD_QUERY, query));
        if (result == null) return;
        if (!result.ok) error("Pack failed: %s", result.message);
        else info("%s", result.message);
    }

    private void unpack() {
        TaskResult result = dispatch(Protocol.TASK_SHULKER_UNPACK, new JsonObject());
        if (result == null) return;
        if (!result.ok) error("Unpack failed: %s", result.message);
        else info("%s", result.message);
    }

    private void restock(String query, int limit) {
        if (query == null || query.isBlank()) {
            error("Supply an item query to restock.");
            return;
        }
        JsonObject payload = payload(Protocol.FIELD_QUERY, query);
        payload.addProperty("limit", limit);
        TaskResult result = dispatch(Protocol.TASK_RESTOCK, payload);
        if (result == null) return;
        if (!result.ok) error("Restock failed: %s", result.message);
        else info("%s", result.message);
    }

    private void portalScan(String action, int radius) {
        JsonObject payload = new JsonObject();
        payload.addProperty("action", action);
        payload.addProperty("radius", radius);
        TaskResult result = dispatch(Protocol.TASK_PORTAL_SCAN, payload);
        if (result == null) return;
        if (!result.ok) error("Portal scan failed: %s", result.message);
        else info("%s", result.message);
    }

    private void status() {
        FleetRuntime runtime = runtime();
        if (!runtime.configured()) {
            info("Worker not configured yet.");
            return;
        }
        WorkerConfig config = runtime.config();
        WorkerLink link = runtime.link();
        WorkerSnapshot snapshot = runtime.snapshot();

        info("Endpoint: %s  Id: %s  Label: %s", config.endpoint(),
            config.workerId.isEmpty() ? "(derived)" : config.workerId,
            config.label.isEmpty() ? "-" : config.label);
        info("State: %s  Paused: %s  Service stopped: %s",
            stateLabel(runtime.state()),
            link != null && link.isPaused() ? "yes" : "no",
            link != null && link.isStopped() ? "yes" : "no");
        if (!snapshot.inWorld) {
            info("Not in a world.");
            return;
        }
        info("Player: %s  Server: %s  Dim: %s", snapshot.username,
            snapshot.serverAddress.isEmpty() ? "-" : snapshot.serverAddress, snapshot.dimension);
        info("Health: %.1f/%.1f  Food: %d  Armor: %d  Totems: %d",
            snapshot.health, snapshot.maxHealth, snapshot.food, snapshot.armorPieces, snapshot.totems);
        info("Pos: %.1f %.1f %.1f  Held: %s", snapshot.x, snapshot.y, snapshot.z,
            snapshot.heldItem.isEmpty() ? "-" : snapshot.heldItem);
        info("Items: %d total, %d distinct, %d free slots", snapshot.totalItems, snapshot.distinctItems, snapshot.freeSlots);
        if (!snapshot.currentTask.isEmpty()) info("Task: %s", snapshot.currentTask);
    }

    private void config() {
        FleetRuntime runtime = runtime();
        if (!runtime.configured()) {
            error("Worker is not configured yet.");
            return;
        }
        WorkerConfig config = runtime.config();
        info("host=%s port=%d workerId=%s group=%s", config.host, config.port,
            config.workerId.isEmpty() ? "(derived)" : config.workerId,
            config.group.isEmpty() ? "-" : config.group);
        info("permits: commands=%s chat=%s regear=%s efly=%s moves=%s unpack=%s pack=%s restock=%s",
            config.allowCommands, config.allowChat, config.allowRegear, config.allowEfly,
            config.allowContainerMoves, config.allowShulkerUnpack, config.allowShulkerPack, config.allowRestock);
        info("heartbeat=%ds reconnect=%ds enabled=%s token=%s",
            config.heartbeatSeconds, config.reconnectSeconds, config.enabled,
            config.token.isEmpty() ? "(none)" : "(set)");
    }

    private void events(int count) {
        List<String> lines = runtime().recentEvents();
        if (lines.isEmpty()) {
            info("No events recorded yet.");
            return;
        }
        int from = Math.max(0, lines.size() - count);
        for (int i = from; i < lines.size(); i++) {
            info(" %s", lines.get(i));
        }
    }

    private void inventory() {
        TaskResult result = dispatch(Protocol.TASK_INVENTORY, new JsonObject());
        if (result == null) return;
        if (!result.ok) {
            error("Inventory failed: %s", result.message);
            return;
        }
        info("%s", result.message);
        info("Carried total: %s  distinct: %s",
            text(result.data, "carriedTotal"), text(result.data, "carriedDistinct"));
    }

    private void count(String query) {
        if (query == null || query.isBlank()) {
            error("Supply an item query.");
            return;
        }
        JsonObject payload = new JsonObject();
        payload.addProperty(Protocol.FIELD_QUERY, query);
        TaskResult result = dispatch(Protocol.TASK_COUNT, payload);
        if (result == null) return;
        if (!result.ok) {
            error("Count failed: %s", result.message);
            return;
        }
        info("Carried %s of '%s' (accessible %s)", text(result.data, "carried"), query, text(result.data, "accessible"));
    }

    private void search(String query) {
        if (query == null || query.isBlank()) {
            error("Supply an item query.");
            return;
        }
        JsonObject payload = new JsonObject();
        payload.addProperty(Protocol.FIELD_QUERY, query);
        TaskResult result = dispatch(Protocol.TASK_SEARCH, payload);
        if (result == null) return;
        if (!result.ok) {
            error("Search failed: %s", result.message);
            return;
        }
        info("Found %s matching stacks.", text(result.data, "total"));
    }

    /** Shows the real classification metadata of matching carried stacks. */
    private void inspect(String query) {
        TaskResult result = dispatch(Protocol.TASK_SEARCH, payload(Protocol.FIELD_QUERY, query));
        if (result == null) return;
        if (!result.ok) {
            error("Inspect failed: %s", result.message);
            return;
        }
        JsonArray matches = result.data.has("matches") && result.data.get("matches").isJsonArray()
            ? result.data.getAsJsonArray("matches") : new JsonArray();
        if (matches.isEmpty()) {
            info("No carried stacks match '%s'.", query);
            return;
        }
        for (var element : matches) {
            JsonObject item = element.getAsJsonObject();
            info("%s x%s", text(item, "name"), text(item, "count"));
            info("  id=%s tags=%s", text(item, "id"), list(item, "tags"));
            info("  enchants=%s components=%s",
                enchantments(item), list(item, "components"));
        }
    }

    private TaskResult dispatch(String kind, JsonObject payload) {
        FleetRuntime runtime = runtime();
        if (!runtime.configured()) {
            error("Worker is not configured yet.");
            return null;
        }
        MinecraftTaskDispatcher dispatcher = runtime.dispatcher();
        if (dispatcher == null) {
            error("Worker dispatcher is not ready.");
            return null;
        }
        String taskId = "local-" + UUID.randomUUID();
        try {
            return dispatcher.dispatch(taskId, kind, payload);
        } catch (RuntimeException ex) {
            error("Task failed: %s", ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage());
            return null;
        }
    }

    private static JsonObject payload(String key, String value) {
        JsonObject payload = new JsonObject();
        payload.addProperty(key, value == null ? "" : value);
        return payload;
    }

    private static String text(JsonObject object, String key) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull()) return "-";
        return object.get(key).getAsString();
    }

    private static String list(JsonObject object, String key) {
        if (object == null || !object.has(key) || !object.get(key).isJsonArray()) return "-";
        JsonArray array = object.getAsJsonArray(key);
        if (array.isEmpty()) return "-";
        StringBuilder builder = new StringBuilder();
        for (var element : array) {
            if (builder.length() > 0) builder.append(", ");
            builder.append(element.getAsString());
        }
        return builder.toString();
    }

    private static String enchantments(JsonObject item) {
        if (item == null || !item.has("enchantments") || !item.get("enchantments").isJsonArray()) return "-";
        JsonArray array = item.getAsJsonArray("enchantments");
        if (array.isEmpty()) return "-";
        StringBuilder builder = new StringBuilder();
        for (var element : array) {
            JsonObject enchant = element.getAsJsonObject();
            if (builder.length() > 0) builder.append(", ");
            builder.append(text(enchant, "id")).append(' ').append(text(enchant, "level"));
        }
        return builder.toString();
    }

    private static String stateLabel(WorkerState state) {
        return switch (state) {
            case REGISTERED -> "registered";
            case CONNECTED, HANDSHAKING -> "handshaking";
            case CONNECTING -> "connecting";
            case BACKING_OFF -> "retrying";
            case DISCONNECTED -> "disconnected";
        };
    }

    private FleetRuntime runtime() {
        return FleetRuntime.get();
    }

    private WorkerLink link() {
        return runtime().link();
    }
}
